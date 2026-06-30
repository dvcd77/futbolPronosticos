/**
 * oddsApi.js — Cliente para The Odds API (the-odds-api.com)
 *
 * Provee cuotas reales de casas de apuestas para comparar contra las
 * probabilidades de nuestros modelos. Tier gratuito: 500 solicitudes/mes.
 *
 * Flujo:
 *   1. fetchWorldCupOdds() trae TODOS los partidos disponibles de una vez
 *      (cacheado 1h — el free tier es muy limitado, hay que cuidar la cuota)
 *   2. matchOddsToTeams() empareja el partido seleccionado por nombre de equipo
 *   3. impliedProbabilities() convierte cuotas decimales → probabilidad,
 *      removiendo el margen de la casa (vig/overround)
 */

import { serverHasOdds } from './serverConfig.js';

const BASE_URL  = '/api/odds';
const SPORT_KEY = 'soccer_fifa_world_cup';
const CACHE_KEY = 'oddsapi_wc_events';
const CACHE_TTL = 60 * 60_000; // 1 hora — proteger cuota mensual (500 req/mes)

// ── localStorage key management ───────────────────────────────────────────────
// hasOddsApiKey considera tanto la key local como el token del servidor.
export function hasOddsApiKey() { return !!localStorage.getItem('oddsapi_key') || serverHasOdds(); }
export function getOddsApiKey() { return localStorage.getItem('oddsapi_key') ?? ''; }
export function setOddsApiKey(key) { localStorage.setItem('oddsapi_key', key.trim()); }
export function getMaskedOddsKey() {
  const k = getOddsApiKey();
  return k ? k.slice(0, 4) + '****' + k.slice(-4) : '';
}

// ── Cache helpers (same pattern as footballApi.js) ────────────────────────────
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}
function cacheSet(key, data, ttl) {
  try { localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl })); }
  catch { /* storage full — ignore */ }
}
export function clearOddsCache() { localStorage.removeItem(CACHE_KEY); }

// ── Test API key ───────────────────────────────────────────────────────────────
export async function testOddsApiKey(key) {
  try {
    const res = await fetch(`${BASE_URL}/sports?apiKey=${encodeURIComponent(key.trim())}`);
    if (res.status === 401) return { ok: false, message: 'API key inválida (401).' };
    if (res.status === 429) return { ok: false, message: 'Cuota mensual agotada (429). El tier gratuito da 500 solicitudes/mes.' };
    if (!res.ok)            return { ok: false, message: `Error ${res.status}: ${res.statusText}` };
    const remaining = res.headers.get('x-requests-remaining');
    return { ok: true, message: `Conexión exitosa.${remaining ? ` Solicitudes restantes este mes: ${remaining}.` : ''}` };
  } catch (e) {
    return { ok: false, message: `Error de red: ${e.message}` };
  }
}

// ── Fetch all World Cup odds events (cached 1h) ───────────────────────────────
export async function fetchWorldCupOdds(force = false) {
  if (!force) {
    const cached = cacheGet(CACHE_KEY);
    if (cached) return cached;
  }

  const key = getOddsApiKey();
  if (!key && !serverHasOdds()) throw new Error('API key de cuotas no configurada.');

  // Si hay key local la incluimos en el query; si no, la omitimos y el servidor
  // (Render) inyectará su token compartido antes de reenviar a The Odds API.
  const url = `${BASE_URL}/sports/${SPORT_KEY}/odds`
    + `?regions=us,uk,eu`
    + `&markets=h2h,totals`
    + `&oddsFormat=decimal`
    + `&dateFormat=iso`
    + (key ? `&apiKey=${encodeURIComponent(key)}` : '');

  const res = await fetch(url);
  if (res.status === 401) throw new Error('API key de cuotas inválida.');
  if (res.status === 429) throw new Error('Cuota mensual de The Odds API agotada (límite: 500/mes en tier gratuito).');
  if (res.status === 404 || res.status === 422) {
    // Sport not currently in season / no odds available
    cacheSet(CACHE_KEY, [], CACHE_TTL);
    return [];
  }
  if (!res.ok) throw new Error(`Error ${res.status} al consultar cuotas.`);

  const data = await res.json();
  cacheSet(CACHE_KEY, data, CACHE_TTL);
  return data;
}

// ── Team name normalization for matching ──────────────────────────────────────
// The Odds API uses English team names; our app uses Spanish + TLA codes.
const NAME_ALIASES = {
  'usa': ['estados unidos', 'united states', 'us'],
  'mex': ['méxico', 'mexico'],
  'can': ['canadá', 'canada'],
  'bra': ['brasil', 'brazil'],
  'arg': ['argentina'],
  'fra': ['francia', 'france'],
  'esp': ['españa', 'spain'],
  'ger': ['alemania', 'germany'],
  'eng': ['inglaterra', 'england'],
  'por': ['portugal'],
  'ned': ['países bajos', 'netherlands', 'holland'],
  'bel': ['bélgica', 'belgium'],
  'cro': ['croacia', 'croatia'],
  'mar': ['marruecos', 'morocco'],
  'jpn': ['japón', 'japan'],
  'kor': ['corea del sur', 'south korea', 'korea republic'],
  'sen': ['senegal'],
  'aus': ['australia'],
  'sui': ['suiza', 'switzerland'],
  'tur': ['turquía', 'turkey', 'türkiye'],
  'col': ['colombia'],
  'uru': ['uruguay'],
  'ecu': ['ecuador'],
  'par': ['paraguay'],
  'pan': ['panamá', 'panama'],
  'ksa': ['arabia saudita', 'saudi arabia'],
  'irn': ['irán', 'iran'],
  'irq': ['iraq'],
  'jor': ['jordania', 'jordan'],
  'uzb': ['uzbekistán', 'uzbekistan'],
  'qat': ['qatar'],
  'alg': ['argelia', 'algeria'],
  'egy': ['egipto', 'egypt'],
  'gha': ['ghana'],
  'tun': ['túnez', 'tunisia'],
  'civ': ['costa de marfil', 'ivory coast', "côte d'ivoire"],
  'cpv': ['cabo verde', 'cape verde'],
  'cod': ['congo rd', 'dr congo', 'congo democratic republic'],
  'rsa': ['sudáfrica', 'south africa'],
  'nzl': ['nueva zelanda', 'new zealand'],
  'cuw': ['curazao', 'curaçao', 'curacao'],
  'hai': ['haití', 'haiti'],
  'aut': ['austria'],
  'sco': ['escocia', 'scotland'],
  'nor': ['noruega', 'norway'],
  'swe': ['suecia', 'sweden'],
  'bih': ['bosnia y herzegovina', 'bosnia and herzegovina', 'bosnia'],
  'cze': ['chequia', 'czech republic', 'czechia'],
};

function normalize(str) {
  return (str ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .trim();
}

/**
 * Check if an Odds API team name matches our app's team (by TLA or Spanish name).
 */
function teamNameMatches(apiName, team) {
  const norm = normalize(apiName);
  const tlaLower = (team.tla ?? '').toLowerCase();
  const aliases = NAME_ALIASES[tlaLower] ?? [];
  if (aliases.some(a => normalize(a) === norm)) return true;
  if (normalize(team.name) === norm) return true;
  if (normalize(team.shortName ?? '') === norm) return true;
  return false;
}

/**
 * Find a matching odds event for the given home/away teams.
 * Returns null if no event found (common — markets open close to match day).
 */
export function matchOddsToTeams(events, homeTeam, awayTeam) {
  if (!events?.length || !homeTeam || !awayTeam) return null;

  return events.find(ev => {
    const homeMatch = teamNameMatches(ev.home_team, homeTeam) || teamNameMatches(ev.home_team, awayTeam);
    const awayMatch = teamNameMatches(ev.away_team, homeTeam) || teamNameMatches(ev.away_team, awayTeam);
    if (!homeMatch || !awayMatch) return false;
    // Confirm it's actually these two teams (not a false double match)
    const evHomeIsOurHome = teamNameMatches(ev.home_team, homeTeam);
    const evAwayIsOurAway = teamNameMatches(ev.away_team, awayTeam);
    const evHomeIsOurAway = teamNameMatches(ev.home_team, awayTeam);
    const evAwayIsOurHome = teamNameMatches(ev.away_team, homeTeam);
    return (evHomeIsOurHome && evAwayIsOurAway) || (evHomeIsOurAway && evAwayIsOurHome);
  }) ?? null;
}

/**
 * Average decimal odds across all available bookmakers for h2h (1X2) market.
 * Returns { home, draw, away } in decimal odds, or null if unavailable.
 */
export function averageH2HOdds(event) {
  if (!event?.bookmakers?.length) return null;

  const sums = { home: 0, draw: 0, away: 0 };
  const counts = { home: 0, draw: 0, away: 0 };

  event.bookmakers.forEach(bk => {
    const market = bk.markets?.find(m => m.key === 'h2h');
    if (!market) return;
    market.outcomes?.forEach(o => {
      if (teamNameMatches(o.name, { name: event.home_team, tla: '' }) || o.name === event.home_team) {
        sums.home += o.price; counts.home++;
      } else if (teamNameMatches(o.name, { name: event.away_team, tla: '' }) || o.name === event.away_team) {
        sums.away += o.price; counts.away++;
      } else if (normalize(o.name) === 'draw') {
        sums.draw += o.price; counts.draw++;
      }
    });
  });

  if (counts.home === 0 || counts.away === 0) return null;

  return {
    home: sums.home / counts.home,
    draw: counts.draw > 0 ? sums.draw / counts.draw : null,
    away: sums.away / counts.away,
    bookmakerCount: event.bookmakers.length,
  };
}

/**
 * Average decimal odds for totals (over/under) market at a given line.
 */
export function averageTotalsOdds(event, line = 2.5) {
  if (!event?.bookmakers?.length) return null;

  let overSum = 0, overCount = 0, underSum = 0, underCount = 0;

  event.bookmakers.forEach(bk => {
    const market = bk.markets?.find(m => m.key === 'totals');
    if (!market) return;
    market.outcomes?.forEach(o => {
      if (Math.abs(o.point - line) > 0.01) return; // wrong line
      if (normalize(o.name) === 'over') { overSum += o.price; overCount++; }
      else if (normalize(o.name) === 'under') { underSum += o.price; underCount++; }
    });
  });

  if (overCount === 0 || underCount === 0) return null;
  return { over: overSum / overCount, under: underSum / underCount, bookmakerCount: event.bookmakers.length };
}

/**
 * Convert decimal odds → implied probability, with vig removal (normalization).
 * Raw implied prob = 1/odds. Removing vig: divide each by the sum (which is >1 due to margin).
 */
export function impliedProbabilities({ home, draw, away }) {
  const rawHome = 1 / home;
  const rawAway = 1 / away;
  const rawDraw = draw ? 1 / draw : 0;
  const overround = rawHome + rawDraw + rawAway;

  return {
    home: rawHome / overround,
    draw: rawDraw / overround,
    away: rawAway / overround,
    overround,                          // e.g. 1.06 = 6% house margin
    vigPercent: (overround - 1) * 100,
  };
}

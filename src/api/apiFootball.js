/**
 * apiFootball.js — Cliente para API-Football (api-sports.io)
 *
 * Complementa a football-data.org: cubre 1,236+ ligas y torneos, incluyendo
 * AFCON, Copa América, Gold Cup y clasificatorias de todas las confederaciones
 * — justo las competencias que football-data.org NO incluye en su tier
 * gratuito. Se usa como fuente SECUNDARIA: enriquece el historial de
 * partidos de un equipo cuando football-data.org no tiene suficientes datos.
 *
 * Tier gratuito: 100 solicitudes/día, 10 solicitudes/minuto, todos los
 * endpoints desbloqueados (solo limita el rango histórico de temporadas).
 *
 * Auth: header `x-apisports-key` — requiere proxy (CORS) igual que football-data.org.
 */

const BASE_URL = '/api/apifootball';   // → proxy server-side (ver server.js)
const RATE_INTERVAL = 6500;            // ~9.2 req/min, deja margen sobre el límite de 10/min
const CACHE_PREFIX = 'afapi_';

const TTL = {
  teamSearch:    7  * 86400_000,  // 7 días — el ID de un equipo no cambia
  teamFixtures:  3  * 3600_000,   // 3 horas
  leagueList:    30 * 86400_000,  // 30 días
};

// ── Rate-limit queue (mismo patrón que footballApi.js) ────────────────────────
let lastRequest = 0;
const queue = [];
let processing = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const { url, resolve, reject } = queue.shift();
    const wait = RATE_INTERVAL - (Date.now() - lastRequest);
    if (wait > 0) await sleep(wait);
    try {
      const data = await doFetch(url);
      lastRequest = Date.now();
      resolve(data);
    } catch (e) {
      reject(e);
    }
  }
  processing = false;
}

function enqueue(url) {
  return new Promise((resolve, reject) => {
    queue.push({ url, resolve, reject });
    processQueue();
  });
}

// ── Cache helpers ──────────────────────────────────────────────────────────
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
    return data;
  } catch { return null; }
}
function cacheSet(key, data, ttl) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, expiry: Date.now() + ttl }));
  } catch { /* storage full */ }
}
export function clearApiFootballCache() {
  Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
}

// ── Core fetch ────────────────────────────────────────────────────────────────
async function doFetch(url) {
  const apiKey = localStorage.getItem('afapi_key');
  if (!apiKey) throw new Error('API-Football key no configurada.');

  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (res.status === 429) throw new Error('Límite diario de API-Football excedido (100/día en tier gratuito).');
  if (!res.ok) throw new Error(`Error API-Football ${res.status}: ${res.statusText}`);

  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

async function fetchCached(url, ttl) {
  const cached = cacheGet(url);
  if (cached) return cached;
  const data = await enqueue(url);
  cacheSet(url, data, ttl);
  return data;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function hasApiFootballKey() { return !!localStorage.getItem('afapi_key'); }
export function getMaskedApiFootballKey() {
  const k = localStorage.getItem('afapi_key') ?? '';
  return k ? k.slice(0, 4) + '****' + k.slice(-4) : '';
}

/** Prueba la key contra el endpoint /status (no consume cuota relevante) */
export async function testApiFootballKey(key) {
  localStorage.setItem('afapi_key', key.trim());
  try {
    const res = await fetch(`${BASE_URL}/status`, { headers: { 'x-apisports-key': key.trim() } });
    if (!res.ok) return { ok: false, message: `Error ${res.status}: ${res.statusText}` };
    const data = await res.json();
    if (data.errors && Object.keys(data.errors).length > 0) {
      return { ok: false, message: JSON.stringify(data.errors) };
    }
    const remaining = data.response?.requests?.limit_day - data.response?.requests?.current;
    return { ok: true, message: `Conexión exitosa. ${remaining ?? '?'} solicitudes restantes hoy.` };
  } catch (e) {
    return { ok: false, message: `Error de red: ${e.message}` };
  }
}

/**
 * Busca el ID interno de API-Football para un equipo por nombre.
 * Necesario porque los IDs de equipo de API-Football son distintos a los de
 * football-data.org — hay que mapear una vez y cachear permanentemente.
 */
export async function searchTeamByName(name) {
  const url = `${BASE_URL}/teams?search=${encodeURIComponent(name)}`;
  const data = await fetchCached(url, TTL.teamSearch);
  return data.response ?? [];
}

/**
 * Trae los partidos de un equipo en una temporada/rango específico.
 * A diferencia de football-data.org, API-Football SÍ incluye AFCON, Copa
 * América, Gold Cup y clasificatorias de todas las confederaciones.
 *
 * @param {number} teamId - ID interno de API-Football (NO el de football-data.org)
 * @param {number} last - cuántos partidos recientes traer (máx 50 recomendado)
 */
export async function fetchTeamFixtures(teamId, last = 20) {
  const url = `${BASE_URL}/fixtures?team=${teamId}&last=${last}`;
  const data = await fetchCached(url, TTL.teamFixtures);
  return data.response ?? [];
}

/**
 * Normaliza un fixture de API-Football a la misma forma que football-data.org,
 * RECONCILIANDO los IDs de equipo por nombre contra nuestra lista de 48
 * equipos del Mundial. Esto es crítico: si no reconciliamos los IDs, el
 * sistema de ELO fragmentaría "Marruecos" en dos entidades distintas según
 * la fuente de datos. Para equipos fuera de nuestra lista (rivales de AFCON
 * que no clasificaron al Mundial, etc.) se genera un ID estable basado en
 * el ID de API-Football — no se reconcilia pero tampoco rompe el cálculo.
 *
 * @param {Object} fx - fixture crudo de API-Football
 * @param {Map<string,object>} nameToTeam - Map de nombre normalizado → team de FALLBACK_TEAMS
 */
const NAME_ALIASES = {
  'usa': 'estados unidos', 'united states': 'estados unidos',
  'south korea': 'corea del sur', 'korea republic': 'corea del sur',
  'ivory coast': 'costa de marfil', "cote d'ivoire": 'costa de marfil', "côte d'ivoire": 'costa de marfil',
  'dr congo': 'congo rd', 'congo dr': 'congo rd',
  'iran': 'irán', 'ir iran': 'irán',
  'saudi arabia': 'arabia saudita',
  'cape verde': 'cabo verde', 'cabo verde islands': 'cabo verde',
  'türkiye': 'turquía', 'turkey': 'turquía',
  'czechia': 'chequia', 'czech republic': 'chequia',
  'bosnia and herzegovina': 'bosnia y herzegovina', 'bosnia': 'bosnia y herzegovina',
  'south africa': 'sudáfrica', 'new zealand': 'nueva zelanda',
  'south korea republic': 'corea del sur',
};

function normalizeTeamName(name) {
  const n = (name ?? '').toLowerCase().trim();
  return NAME_ALIASES[n] ?? n;
}

export function buildNameToTeamMap(teams) {
  const map = new Map();
  teams.forEach(t => map.set(normalizeTeamName(t.name), t));
  return map;
}

export function normalizeApiFootballFixture(fx, nameToTeam) {
  if (fx.fixture?.status?.short !== 'FT') return null; // solo partidos finalizados

  function resolveTeam(rawTeam) {
    const matched = nameToTeam?.get(normalizeTeamName(rawTeam.name));
    if (matched) return { id: matched.id, name: matched.name }; // reconciliado con football-data.org
    return { id: `af_${rawTeam.id}`, name: rawTeam.name };       // rival fuera de nuestra lista
  }

  return {
    id: `af_${fx.fixture.id}`,
    utcDate: fx.fixture.date,
    status: 'FINISHED',
    competition: { code: fx.league?.name ?? 'UNKNOWN', name: fx.league?.name },
    homeTeam: resolveTeam(fx.teams.home),
    awayTeam: resolveTeam(fx.teams.away),
    score: {
      fullTime: { home: fx.goals?.home ?? null, away: fx.goals?.away ?? null },
    },
    source: 'api-football',
  };
}

/**
 * Resuelve y cachea PERMANENTEMENTE el ID interno de API-Football para un
 * equipo del Mundial, buscando por nombre. Solo se llama una vez por equipo
 * (el ID nunca cambia), ahorrando cuota diaria en visitas futuras.
 */
export async function findApiFootballTeamId(teamName) {
  const cacheKey = `afapi_teamid_${teamName.toLowerCase()}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return Number(cached);

  const results = await searchTeamByName(teamName);
  if (!results.length) return null;

  // Prioriza coincidencia exacta de nombre + tipo "National" si está disponible
  const exact = results.find(r =>
    r.team?.name?.toLowerCase() === teamName.toLowerCase() && r.team?.national
  ) ?? results.find(r => r.team?.national) ?? results[0];

  const id = exact?.team?.id;
  if (id) localStorage.setItem(cacheKey, String(id));
  return id ?? null;
}

export function getQueueLength() { return queue.length; }

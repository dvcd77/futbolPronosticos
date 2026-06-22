/**
 * espnApi.js — Cliente para la API pública (NO oficial) de ESPN.
 *
 * ⚠️ IMPORTANTE — naturaleza de esta fuente:
 * Esta es una API NO documentada que ESPN usa internamente para alimentar
 * su propio sitio. No requiere API key, no tiene límite de rate publicado,
 * y la usan cientos de proyectos comunitarios desde hace años — pero
 * técnicamente puede cambiar sin previo aviso. Por eso se usa aquí como
 * fuente TERCIARIA: solo se consulta cuando football-data.org y
 * API-Football no devuelven suficientes datos, nunca como fuente primaria.
 *
 * Qué aporta sobre las otras 2 fuentes:
 *   1. Redundancia — si las otras 2 fallan o se agota su cuota diaria,
 *      seguimos teniendo datos de partidos.
 *   2. Amistosos internacionales — la categoría más débilmente cubierta
 *      en cualquier API estructurada de fútbol.
 *
 * No requiere autenticación — el proxy en server.js no necesita reenviar
 * ningún header de auth, a diferencia de football-data.org y API-Football.
 */

const BASE_URL = '/api/espn';      // → proxy server-side (ver server.js)
const RATE_INTERVAL = 1200;        // sin límite oficial, pero nos auto-limitamos por respeto
const CACHE_PREFIX = 'espn_';

const TTL = {
  teamList:     30 * 86400_000,   // 30 días — la lista de equipos del Mundial no cambia
  teamSchedule:  6 * 3600_000,    // 6 horas
};

// ── Rate-limit queue (mismo patrón que las otras fuentes) ─────────────────────
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

// ── Cache ──────────────────────────────────────────────────────────────────
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
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, expiry: Date.now() + ttl })); }
  catch { /* storage full */ }
}
export function clearEspnCache() {
  Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
}

// ── Core fetch (sin auth — ESPN no requiere key) ──────────────────────────────
async function doFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API ${res.status}: ${res.statusText}`);
  return res.json();
}
async function fetchCached(url, ttl) {
  const cached = cacheGet(url);
  if (cached) return cached;
  const data = await enqueue(url);
  cacheSet(url, data, ttl);
  return data;
}

// ── Estado: habilitado/deshabilitado (no requiere key, solo un toggle) ───────
export function isEspnEnabled() {
  return localStorage.getItem('espn_enabled') === 'true';
}
export function setEspnEnabled(enabled) {
  localStorage.setItem('espn_enabled', enabled ? 'true' : 'false');
}

/** Prueba de conectividad simple — sin auth, solo confirma que el proxy responde */
export async function testEspnConnection() {
  try {
    const data = await fetchCached(`${BASE_URL}/fifa.world/teams`, TTL.teamList);
    const count = data?.sports?.[0]?.leagues?.[0]?.teams?.length ?? 0;
    return { ok: count > 0, message: `Conexión exitosa. ${count} equipos del Mundial encontrados.` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * Trae la lista de equipos del Mundial 2026 desde ESPN (1 sola llamada,
 * cubre los 48 equipos). Se usa para mapear nombre → ID interno de ESPN.
 */
export async function fetchEspnWorldCupTeams() {
  const data = await fetchCached(`${BASE_URL}/fifa.world/teams`, TTL.teamList);
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map(t => ({
    espnId: t.team?.id,
    name: t.team?.displayName ?? t.team?.name,
    abbreviation: t.team?.abbreviation,
  }));
}

/**
 * Trae el calendario/historial de un equipo por su ID de ESPN.
 * El endpoint de "schedule" de ESPN agrega partidos de MÚLTIPLES
 * competencias (amistosos, clasificatorias, copas continentales) en una
 * sola respuesta — no hace falta consultar liga por liga.
 */
export async function fetchEspnTeamSchedule(espnTeamId) {
  const url = `${BASE_URL}/fifa.world/teams/${espnTeamId}/schedule`;
  const data = await fetchCached(url, TTL.teamSchedule);
  return data?.events ?? [];
}

/**
 * Normaliza un evento de ESPN a la forma común usada por nuestros modelos,
 * reconciliando el ID del equipo por nombre contra nuestra lista de 48
 * equipos (mismo patrón que apiFootball.js, evita fragmentar el ELO).
 *
 * @param {Object} ev - evento crudo de ESPN
 * @param {Map<string,object>} nameToTeam - Map construido con buildNameToTeamMap
 *   de apiFootball.js (claves en inglés normalizado) — se reutiliza esa misma
 *   función para que ESPN y API-Football reconcilien exactamente igual.
 * @param {Function} normalizeFn - normalizeTeamName de apiFootball.js (aplica
 *   alias de variantes de nombre, ej. "Korea Republic" → "south korea")
 */
export function normalizeEspnEvent(ev, nameToTeam, normalizeFn) {
  const comp = ev.competitions?.[0];
  if (!comp || comp.status?.type?.completed !== true) return null;

  const homeC = comp.competitors?.find(c => c.homeAway === 'home');
  const awayC = comp.competitors?.find(c => c.homeAway === 'away');
  if (!homeC || !awayC) return null;

  const normalize = normalizeFn ?? (n => (n ?? '').toLowerCase().trim());

  function resolveTeam(c) {
    const rawName = c.team?.displayName ?? c.team?.name ?? '';
    const matched = nameToTeam?.get(normalize(rawName));
    if (matched) return { id: matched.id, name: matched.name };
    return { id: `espn_${c.team?.id}`, name: rawName };
  }

  const homeScore = Number(homeC.score);
  const awayScore = Number(awayC.score);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return null;

  return {
    id: `espn_${ev.id}`,
    utcDate: ev.date,
    status: 'FINISHED',
    competition: { code: comp.notes?.[0]?.headline ?? ev.season?.slug ?? 'UNKNOWN' },
    homeTeam: resolveTeam(homeC),
    awayTeam: resolveTeam(awayC),
    score: { fullTime: { home: homeScore, away: awayScore } },
    source: 'espn',
  };
}

/**
 * Resuelve el ID interno de ESPN para un equipo, usando la lista completa
 * de equipos del Mundial (1 sola llamada cubre los 48, a diferencia de
 * API-Football que requiere una búsqueda por equipo). Cachea el mapeo
 * completo permanentemente tras la primera consulta.
 */
let espnTeamIdCache = null; // Map<nombreNormalizado, espnId> en memoria, además del localStorage

export async function findEspnTeamId(teamName, normalizeFn) {
  const normalize = normalizeFn ?? (n => (n ?? '').toLowerCase().trim());

  if (!espnTeamIdCache) {
    // Intenta restaurar desde localStorage primero
    const cached = cacheGet('teamIdMap');
    if (cached) {
      espnTeamIdCache = new Map(cached);
    } else {
      const teams = await fetchEspnWorldCupTeams();
      espnTeamIdCache = new Map(
        teams.filter(t => t.espnId).map(t => [normalize(t.name), t.espnId])
      );
      cacheSet('teamIdMap', [...espnTeamIdCache.entries()], TTL.teamList);
    }
  }

  return espnTeamIdCache.get(normalize(teamName)) ?? null;
}

export function getQueueLength() { return queue.length; }

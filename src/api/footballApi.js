const BASE_URL = '/api/football';    // → proxy en el mismo servidor (sin CORS)
const RATE_INTERVAL = 6200;   // ms between requests (10/min = 1/6s + buffer)
const CACHE_PREFIX = 'fdapi_';

const TTL = {
  teams:       24 * 3600_000,  // 24h
  fixtures:     2 * 3600_000,  // 2h
  teamMatches:  7 * 86400_000, // 7d
  standings:    3 * 3600_000,  // 3h
  scorers:     12 * 3600_000,  // 12h
};

// ── Rate-limit queue ──────────────────────────────────────────────────────────
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

// ── Cache helpers ─────────────────────────────────────────────────────────────
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
  } catch { /* storage full – silently ignore */ }
}

export function clearCache() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
  keys.forEach(k => localStorage.removeItem(k));
}

// ── Core fetch ────────────────────────────────────────────────────────────────
async function doFetch(url) {
  const apiKey = localStorage.getItem('fdapi_key');
  if (!apiKey) throw new Error('API key no configurada. Ve a Configuración.');

  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });

  if (res.status === 429) throw new Error('Límite de rate excedido. Espera un momento.');
  if (res.status === 403) throw new Error('API key inválida o sin permisos para esta competencia.');
  if (!res.ok) throw new Error(`Error API ${res.status}: ${res.statusText}`);

  return res.json();
}

async function fetchCached(url, ttl) {
  const cached = cacheGet(url);
  if (cached) return cached;
  const data = await enqueue(url);
  cacheSet(url, data, ttl);
  return data;
}

// ── Public API functions ──────────────────────────────────────────────────────

/** Test API key validity — returns { ok, message, competitions } */
export async function testApiKey(key) {
  // Always save the key first (never delete it based on test result)
  localStorage.setItem('fdapi_key', key.trim());
  try {
    // Use /competitions — works with any valid free-tier key
    const res = await fetch(`${BASE_URL}/competitions`, {
      headers: { 'X-Auth-Token': key.trim() },
    });
    if (res.status === 400) return { ok: false, message: 'API key inválida (400). Verifica que la copiaste completa.' };
    if (res.status === 403) return { ok: false, message: 'Key inválida o cuenta no verificada (403). ¿Confirmaste tu correo en football-data.org?' };
    if (res.status === 429) return { ok: false, message: 'Demasiadas peticiones (429). Espera 1 minuto e intenta de nuevo.' };
    if (!res.ok)            return { ok: false, message: `Error ${res.status}: ${res.statusText}` };
    const data = await res.json();
    const competitions = (data.competitions ?? []).map(c => c.code).join(', ');
    return { ok: true, message: `Conexión exitosa. Competencias disponibles: ${competitions || 'WC, PL, BL1..'}` };
  } catch (e) {
    // Network / CORS error
    return { ok: false, message: `Error de red: ${e.message}. Verifica tu conexión a internet.` };
  }
}

/** Get all teams in a competition */
export async function fetchTeams(competitionCode = 'WC') {
  const url = `${BASE_URL}/competitions/${competitionCode}/teams`;
  const data = await fetchCached(url, TTL.teams);
  return data.teams ?? [];
}

/** Get matches for a competition (season optional) */
export async function fetchCompetitionMatches(competitionCode = 'WC', season = 2026) {
  const url = `${BASE_URL}/competitions/${competitionCode}/matches?season=${season}`;
  const data = await fetchCached(url, TTL.fixtures);
  return data.matches ?? [];
}

/** Get historical matches for a team */
export async function fetchTeamMatches(teamId, dateFrom = '2019-01-01') {
  const dateTo = new Date().toISOString().slice(0, 10);
  const url = `${BASE_URL}/teams/${teamId}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=50`;
  const data = await fetchCached(url, TTL.teamMatches);
  return data.matches ?? [];
}

/** Get standings for a competition */
export async function fetchStandings(competitionCode = 'WC') {
  const url = `${BASE_URL}/competitions/${competitionCode}/standings`;
  const data = await fetchCached(url, TTL.standings);
  return data.standings ?? [];
}

/** Get squad (player list) for a team */
export async function fetchTeamSquad(teamId) {
  const url = `${BASE_URL}/teams/${teamId}`;
  const data = await fetchCached(url, TTL.teams);
  return data.squad ?? [];
}

/** Get top scorers for a competition */
export async function fetchScorers(competitionCode = 'WC', limit = 50) {
  const url = `${BASE_URL}/competitions/${competitionCode}/scorers?limit=${limit}`;
  const data = await fetchCached(url, TTL.scorers);
  return data.scorers ?? [];
}

/** Returns pending queue length for UI status indicator */
export function getQueueLength() { return queue.length; }

/** Returns true if an API key is stored */
export function hasApiKey() { return !!localStorage.getItem('fdapi_key'); }

/** Get stored API key (masked) */
export function getMaskedKey() {
  const k = localStorage.getItem('fdapi_key') ?? '';
  if (!k) return '';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

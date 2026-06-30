/**
 * serverConfig.js — Detecta qué tokens provee el servidor (variables de entorno)
 *
 * Permite el modelo de "tokens compartidos": si el servidor (Render) tiene los
 * tokens configurados como variables de entorno, TODOS los dispositivos y
 * usuarios los usan sin ingresarlos en cada navegador. Este módulo consulta
 * /api/server-config (que NO expone los tokens, solo si están presentes) y
 * cachea el resultado en memoria para el resto de la sesión.
 */

let cachedConfig = null;
let fetchPromise = null;

const EMPTY = { footballData: false, apiFootball: false, odds: false };

/**
 * Consulta una sola vez al servidor qué tokens provee. El resultado se cachea
 * en memoria. Llamadas concurrentes comparten la misma promesa (sin duplicar).
 */
export async function loadServerConfig() {
  if (cachedConfig) return cachedConfig;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const res = await fetch('/api/server-config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cachedConfig = data.serverTokens ?? EMPTY;
    } catch {
      // Si el endpoint no existe (p.ej. dev sin server.js), asumimos sin tokens
      cachedConfig = EMPTY;
    }
    return cachedConfig;
  })();

  return fetchPromise;
}

/**
 * Lectura SÍNCRONA del estado cacheado (tras loadServerConfig).
 * Devuelve EMPTY si aún no se ha cargado.
 */
export function getServerConfig() {
  return cachedConfig ?? EMPTY;
}

/** ¿El servidor provee el token de football-data.org? */
export function serverHasFootballData() { return getServerConfig().footballData; }
/** ¿El servidor provee el token de API-Football? */
export function serverHasApiFootball() { return getServerConfig().apiFootball; }
/** ¿El servidor provee el token de The Odds API? */
export function serverHasOdds() { return getServerConfig().odds; }

/**
 * server.js — Proxy CORS para Render (Node.js, Express 5)
 *
 * Problema: el navegador bloquea fetch() directo a APIs externas (CORS).
 * Solución: este servidor actúa de proxy en el mismo origen del frontend:
 *
 *   Browser → /api/football/*     → api.football-data.org/v4/*
 *   Browser → /api/odds/*         → api.the-odds-api.com/v4/*
 *   Browser → /api/apifootball/*  → v3.football.api-sports.io/*
 *   Browser → /api/espn/*         → site.api.espn.com/apis/site/v2/sports/soccer/*
 *
 * TOKENS COMPARTIDOS (variables de entorno):
 *   El servidor puede inyectar los tokens desde variables de entorno, de modo
 *   que TODOS los dispositivos (PC, celular) y usuarios compartan las mismas
 *   credenciales sin tener que ingresarlas en cada navegador. Se configuran
 *   UNA vez en el panel de Render → Environment:
 *     FOOTBALL_DATA_KEY, API_FOOTBALL_KEY, ODDS_API_KEY
 *
 *   Diseño híbrido: si el navegador SÍ envía su propio token (header), ese
 *   tiene prioridad (permite que alguien use su cuenta personal). Si no envía
 *   nada, se usa el token del servidor. Así los tokens compartidos nunca
 *   quedan expuestos en el navegador de los usuarios.
 */

import express from 'express';
import https   from 'https';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';

const app       = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 3000;

// ── Tokens compartidos desde variables de entorno (configurar en Render) ──────
const SERVER_TOKENS = {
  footballData: process.env.FOOTBALL_DATA_KEY || '',
  apiFootball:  process.env.API_FOOTBALL_KEY  || '',
  odds:         process.env.ODDS_API_KEY      || '',
};

// Log informativo al arrancar (sin revelar los tokens, solo si están presentes)
console.log('🔑 Tokens de servidor:',
  `football-data=${SERVER_TOKENS.footballData ? 'sí' : 'no'}`,
  `api-football=${SERVER_TOKENS.apiFootball ? 'sí' : 'no'}`,
  `odds=${SERVER_TOKENS.odds ? 'sí' : 'no'}`);

// ── 1. Servir el build de Vite ────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')));

// Endpoint que le dice al frontend qué tokens ya provee el servidor, para que
// la UI pueda ocultar/ajustar los campos correspondientes. NO expone los
// tokens, solo si están configurados (booleanos).
app.get('/api/server-config', (_req, res) => {
  res.json({
    serverTokens: {
      footballData: !!SERVER_TOKENS.footballData,
      apiFootball:  !!SERVER_TOKENS.apiFootball,
      odds:         !!SERVER_TOKENS.odds,
    },
  });
});

// ── Generic HTTPS proxy helper ────────────────────────────────────────────────
function proxyTo(hostname, pathPrefix) {
  return (req, res) => {
    const options = {
      hostname,
      port:   443,
      path:   `${pathPrefix}${req.url}`,
      method: 'GET',
      headers: req._proxyHeaders ?? {},
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode);
      ['content-type', 'x-requests-available-minute', 'x-requestcounter-reset',
       'x-requests-remaining', 'x-requests-used']
        .forEach(h => { if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]); });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      console.error(`[proxy:${hostname}]`, err.message);
      if (!res.headersSent) res.status(502).json({ message: `Proxy error: ${err.message}` });
    });

    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy();
      if (!res.headersSent) res.status(504).json({ message: `Timeout al contactar ${hostname}` });
    });

    proxyReq.end();
  };
}

// ── 2. Proxy /api/football/* → api.football-data.org/v4/* ────────────────────
// Token: el del navegador tiene prioridad; si no, el del servidor (env var).
app.use('/api/football', (req, res, next) => {
  const token = req.headers['x-auth-token'] || SERVER_TOKENS.footballData;
  if (!token) return res.status(401).json({ message: 'Falta X-Auth-Token (ni en el navegador ni en el servidor)' });
  req._proxyHeaders = {
    'X-Auth-Token': token,
    'Accept':       'application/json',
    'User-Agent':   'WC2026-Predictor/1.0',
  };
  next();
}, proxyTo('api.football-data.org', '/v4'));

// ── 3. Proxy /api/odds/* → api.the-odds-api.com/v4/* ──────────────────────────
// The Odds API usa apiKey como QUERY PARAM (no header). Si el navegador no la
// incluyó (porque usamos el token compartido del servidor), la inyectamos en
// la URL antes de reenviar.
app.use('/api/odds', (req, res, next) => {
  // ¿La petición ya trae apiKey en el query? Si no, y el servidor tiene token,
  // lo añadimos a req.url para que llegue a The Odds API.
  if (!/[?&]apiKey=/.test(req.url) && SERVER_TOKENS.odds) {
    const sep = req.url.includes('?') ? '&' : '?';
    req.url = `${req.url}${sep}apiKey=${encodeURIComponent(SERVER_TOKENS.odds)}`;
  }
  req._proxyHeaders = { 'Accept': 'application/json', 'User-Agent': 'WC2026-Predictor/1.0' };
  next();
}, proxyTo('api.the-odds-api.com', '/v4'));

// ── 3b. Proxy /api/apifootball/* → v3.football.api-sports.io/* ────────────────
// Cubre AFCON, Copa América, Gold Cup y clasificatorias que football-data.org
// no incluye en su tier gratuito.
// Token: el del navegador tiene prioridad; si no, el del servidor (env var).
app.use('/api/apifootball', (req, res, next) => {
  const key = req.headers['x-apisports-key'] || SERVER_TOKENS.apiFootball;
  if (!key) return res.status(401).json({ message: 'Falta x-apisports-key (ni en el navegador ni en el servidor)' });
  req._proxyHeaders = {
    'x-apisports-key': key,
    'Accept':          'application/json',
    'User-Agent':      'WC2026-Predictor/1.0',
  };
  next();
}, proxyTo('v3.football.api-sports.io', ''));

// ── 3c. Proxy /api/espn/* → site.api.espn.com/apis/site/v2/sports/soccer/* ────
// API no oficial de ESPN, sin autenticación — fuente terciaria de respaldo.
app.use('/api/espn', (req, res, next) => {
  req._proxyHeaders = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 WC2026-Predictor/1.0' };
  next();
}, proxyTo('site.api.espn.com', '/apis/site/v2/sports/soccer'));

// ── 4. SPA fallback — Express 5: wildcard se escribe '{*path}' ────────────────
app.get('{*path}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ WC2026 Predictor en puerto ${PORT}`));

/**
 * server.js — Proxy CORS para Render (Node.js, Express 5)
 *
 * Problema: el navegador bloquea fetch() directo a APIs externas (CORS).
 * Solución: este servidor actúa de proxy en el mismo origen del frontend:
 *
 *   Browser → /api/football/*     → api.football-data.org/v4/*
 *   Browser → /api/odds/*         → api.the-odds-api.com/v4/*
 *   Browser → /api/apifootball/*  → v3.football.api-sports.io/*
 */

import express from 'express';
import https   from 'https';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';

const app       = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 3000;

// ── 1. Servir el build de Vite ────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')));

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
// Requiere cabecera X-Auth-Token del cliente
app.use('/api/football', (req, res, next) => {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ message: 'Falta X-Auth-Token' });
  req._proxyHeaders = {
    'X-Auth-Token': token,
    'Accept':       'application/json',
    'User-Agent':   'WC2026-Predictor/1.0',
  };
  next();
}, proxyTo('api.football-data.org', '/v4'));

// ── 3. Proxy /api/odds/* → api.the-odds-api.com/v4/* ──────────────────────────
// The Odds API usa apiKey como query param (no header), se reenvía tal cual
app.use('/api/odds', (req, res, next) => {
  req._proxyHeaders = { 'Accept': 'application/json', 'User-Agent': 'WC2026-Predictor/1.0' };
  next();
}, proxyTo('api.the-odds-api.com', '/v4'));

// ── 3b. Proxy /api/apifootball/* → v3.football.api-sports.io/* ────────────────
// Cubre AFCON, Copa América, Gold Cup y clasificatorias que football-data.org
// no incluye en su tier gratuito. Requiere cabecera x-apisports-key.
app.use('/api/apifootball', (req, res, next) => {
  const key = req.headers['x-apisports-key'];
  if (!key) return res.status(401).json({ message: 'Falta x-apisports-key' });
  req._proxyHeaders = {
    'x-apisports-key': key,
    'Accept':          'application/json',
    'User-Agent':      'WC2026-Predictor/1.0',
  };
  next();
}, proxyTo('v3.football.api-sports.io', ''));

// ── 4. SPA fallback — Express 5: wildcard se escribe '{*path}' ────────────────
app.get('{*path}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ WC2026 Predictor en puerto ${PORT}`));

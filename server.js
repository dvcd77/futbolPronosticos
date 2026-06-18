/**
 * server.js — Proxy CORS para Render (Node.js, Express 5)
 *
 * Problema: el navegador bloquea fetch() a api.football-data.org con la
 * cabecera X-Auth-Token (CORS preflight falla, "Failed to fetch").
 *
 * Solución: este servidor actúa de proxy en el mismo origen del frontend:
 *   Browser → /api/football/* (mismo origen, sin CORS)
 *            → Este server → api.football-data.org (server-to-server, sin CORS)
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

// ── 2. Proxy /api/football/* → api.football-data.org/v4/* ────────────────────
// Nota: Express 5 usa app.use() con función; funciona igual que en Express 4
app.use('/api/football', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token) {
    return res.status(401).json({ message: 'Falta X-Auth-Token' });
  }

  const options = {
    hostname: 'api.football-data.org',
    port:     443,
    path:     `/v4${req.url}`,
    method:   'GET',
    headers: {
      'X-Auth-Token': token,
      'Accept':       'application/json',
      'User-Agent':   'WC2026-Predictor/1.0',
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    // Reenviar headers relevantes
    ['content-type', 'x-requests-available-minute', 'x-requestcounter-reset']
      .forEach(h => { if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]); });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    console.error('[proxy]', err.message);
    if (!res.headersSent) res.status(502).json({ message: `Proxy error: ${err.message}` });
  });

  proxyReq.setTimeout(15000, () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ message: 'Timeout al contactar football-data.org' });
  });

  proxyReq.end();
});

// ── 3. SPA fallback — Express 5: wildcard se escribe '{*path}' ────────────────
app.get('{*path}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ WC2026 Predictor en puerto ${PORT}`));

import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { SectionTitle, Spinner } from '../ui/Shared.jsx';
import { testApiKey, clearCache, getMaskedKey, hasApiKey } from '../../api/footballApi.js';
import { fetchTeams, fetchCompetitionMatches } from '../../api/footballApi.js';
import { testOddsApiKey, setOddsApiKey, getMaskedOddsKey, hasOddsApiKey, clearOddsCache } from '../../api/oddsApi.js';
import {
  testApiFootballKey, hasApiFootballKey, getMaskedApiFootballKey, clearApiFootballCache,
} from '../../api/apiFootball.js';
import { buildEloRatings } from '../../models/elo.js';
import { FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { DEFAULT_WEIGHTS } from '../../models/ensemble.js';

export default function Settings() {
  const { simCount, setSimCount, setWeights, setTeams, setEloRatings, setTeamMatchCache, setApiStatus } = useApp();

  const [apiKey, setApiKey] = useState(localStorage.getItem('fdapi_key') ?? '');
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | { ok, message }
  const [loadingData, setLoadingData] = useState(false);
  const [loadLog, setLoadLog] = useState([]);
  const [cacheCleared, setCacheCleared] = useState(false);

  // ── Odds API state ──────────────────────────────────────────────────────────
  const [oddsKey, setOddsKeyInput] = useState(getMaskedOddsKey() ? '' : '');
  const [oddsTestStatus, setOddsTestStatus] = useState(null);
  const [oddsCacheCleared, setOddsCacheCleared] = useState(false);

  // ── API-Football state (cobertura ampliada: AFCON, Copa América, Gold Cup) ──
  const [afKey, setAfKeyInput] = useState('');
  const [afTestStatus, setAfTestStatus] = useState(null);
  const [afCacheCleared, setAfCacheCleared] = useState(false);

  function appendLog(msg) {
    setLoadLog(prev => [...prev, msg]);
  }

  async function handleSaveAndTest() {
    if (!apiKey.trim()) return;
    setTestStatus('testing');
    setLoadLog([]);
    const result = await testApiKey(apiKey.trim());
    setTestStatus(result);
    setApiStatus({ ok: result.ok, queue: 0 });
  }

  async function handleSaveAndTestOdds() {
    if (!oddsKey.trim()) return;
    setOddsTestStatus('testing');
    setOddsApiKey(oddsKey.trim());
    const result = await testOddsApiKey(oddsKey.trim());
    setOddsTestStatus(result);
  }

  function handleClearOddsCache() {
    clearOddsCache();
    setOddsCacheCleared(true);
    setTimeout(() => setOddsCacheCleared(false), 2000);
  }

  async function handleSaveAndTestAf() {
    if (!afKey.trim()) return;
    setAfTestStatus('testing');
    const result = await testApiFootballKey(afKey.trim());
    setAfTestStatus(result);
  }

  function handleClearAfCache() {
    clearApiFootballCache();
    // También limpia los IDs de equipo cacheados permanentemente
    Object.keys(localStorage).filter(k => k.startsWith('afapi_teamid_')).forEach(k => localStorage.removeItem(k));
    setAfCacheCleared(true);
    setTimeout(() => setAfCacheCleared(false), 2000);
  }

  async function handleLoadData() {
    setLoadingData(true);
    setLoadLog(['Conectando con football-data.org...']);

    // Build a TLA → { name (ES), conf } lookup from our curated list
    const tlaMeta = {};
    FALLBACK_TEAMS.forEach(t => { tlaMeta[t.tla] = { name: t.name, conf: t.conf }; });

    try {
      appendLog('📡 Cargando equipos del Mundial 2026...');
      const teamList = await fetchTeams('WC');
      if (teamList.length > 0) {
        // Enrich API teams: add Spanish name + confederation from FALLBACK_TEAMS by TLA
        const enriched = teamList.map(t => {
          const meta = tlaMeta[t.tla] ?? tlaMeta[t.shortName];
          return {
            ...t,
            name: meta?.name ?? t.name,       // Spanish name (falls back to English)
            conf: meta?.conf ?? 'Otros',       // Confederation (required for grouping)
          };
        });
        setTeams(enriched);
        appendLog(`✅ ${enriched.length} equipos del Mundial 2026 cargados.`);
      } else {
        setTeams(FALLBACK_TEAMS);
        appendLog('ℹ️ Sin equipos en la API (posiblemente temporada aún no disponible). Usando lista predeterminada.');
      }
    } catch (e) {
      setTeams(FALLBACK_TEAMS);
      appendLog(`⚠️ No se pudieron cargar equipos: ${e.message}`);
      appendLog('ℹ️ Usando equipos predeterminados (48 equipos).');
    }

    try {
      appendLog('📡 Cargando partidos del Mundial 2026...');
      const matches = await fetchCompetitionMatches('WC', 2026);
      if (matches.length > 0) {
        const elo = buildEloRatings(matches);
        setEloRatings(elo);
        appendLog(`✅ ${matches.length} partidos cargados. ELO calculado para ${elo.size} equipos.`);

        // Populate teamMatchCache with WC matches grouped by team.
        // This gives Poisson / Form / xG / ML real data without extra API calls.
        const byTeam = {};
        matches.forEach(m => {
          [m.homeTeam?.id, m.awayTeam?.id].filter(Boolean).forEach(tid => {
            if (!byTeam[tid]) byTeam[tid] = [];
            byTeam[tid].push(m);
          });
        });
        setTeamMatchCache(prev => {
          const next = { ...prev };
          // Only seed if team doesn't have a full history cached already
          Object.entries(byTeam).forEach(([tid, ms]) => {
            const id = Number(tid);
            if (!next[id] || next[id].length < ms.length) next[id] = ms;
          });
          return next;
        });
        const teamsWithMatches = Object.keys(byTeam).length;
        appendLog(`📊 Historial WC pre-cargado para ${teamsWithMatches} equipos (modelos usarán datos reales).`);
      } else {
        appendLog('ℹ️ Sin partidos WC 2026 disponibles en este momento. Los modelos usarán ratings ELO base.');
      }
    } catch (e) {
      appendLog(`⚠️ Partidos WC: ${e.message}`);
    }

    appendLog('✅ Listo. Ve a 🎯 Pronóstico y selecciona un partido.');
    setLoadingData(false);
    setApiStatus(prev => ({ ...prev, ok: true }));
  }

  function handleClearCache() {
    clearCache();
    setTeamMatchCache({});
    setEloRatings(new Map());
    setCacheCleared(true);
    setLoadLog(['🗑 Caché borrada.']);
    setTimeout(() => setCacheCleared(false), 2500);
  }

  const isKeySet = !!apiKey.trim();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── API Key ── */}
      <div className="card">
        <SectionTitle sub="Paso 1 · Consigue tu token gratis en football-data.org">
          🔑 API Key · football-data.org
        </SectionTitle>

        {/* Steps callout */}
        <div style={{
          background: '#0A1225', border: '1px solid #162844', borderRadius: 8,
          padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#5a7a9a', lineHeight: 1.9,
        }}>
          <div style={{ color: '#7AACCC', fontWeight: 600, marginBottom: 6 }}>Cómo obtener tu token:</div>
          <div>1. Ve a <a href="https://www.football-data.org/client/register" target="_blank" rel="noreferrer"
              style={{ color: '#00D4AA' }}>football-data.org/client/register</a></div>
          <div>2. Crea una cuenta gratuita y verifica tu correo</div>
          <div>3. En tu panel, copia el token de <strong style={{ color: '#D8E6F3' }}>My Account → API Key</strong></div>
          <div>4. Pégalo abajo y haz clic en <strong style={{ color: '#00D4AA' }}>Guardar y probar</strong></div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div className="label-sm" style={{ marginBottom: 6 }}>Tu API Token</div>
          <input
            type="text"
            placeholder="p.ej. a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setTestStatus(null); }}
            style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}
          />
          {hasApiKey() && !apiKey.trim() && (
            <div style={{ fontSize: 11, color: '#3a5070', marginTop: 4 }}>
              Key guardada: {getMaskedKey()}
            </div>
          )}
        </div>

        <button
          className="btn-primary"
          onClick={handleSaveAndTest}
          disabled={!isKeySet || testStatus === 'testing'}
          style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
        >
          {testStatus === 'testing'
            ? <><Spinner size={15} /> Probando conexión...</>
            : '💾 Guardar y probar conexión'}
        </button>

        {/* Test result */}
        {testStatus && testStatus !== 'testing' && (
          <div style={{
            padding: '12px 16px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
            background: testStatus.ok ? '#0d2e1e' : '#2e0d0d',
            border: `1px solid ${testStatus.ok ? '#1a4a2e' : '#4a1a1a'}`,
            color: testStatus.ok ? '#3FB950' : '#F85149',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {testStatus.ok ? '✅ Conexión exitosa' : '❌ Error de conexión'}
            </div>
            <div style={{ fontSize: 12, color: testStatus.ok ? '#2a8040' : '#c04040' }}>
              {testStatus.message}
            </div>
          </div>
        )}

        {/* Paso 2: cargar datos */}
        {(testStatus?.ok || hasApiKey()) && (
          <div style={{ marginTop: 16, borderTop: '1px solid #162844', paddingTop: 16 }}>
            <div className="label-sm" style={{ marginBottom: 10 }}>
              Paso 2 · Cargar datos del Mundial
            </div>
            <button
              className="btn-primary"
              onClick={handleLoadData}
              disabled={loadingData}
              style={{ width: '100%', justifyContent: 'center', background: '#0d3a2a', color: '#00D4AA', border: '1px solid #1a5a40' }}
            >
              {loadingData ? <><Spinner size={15} /> Cargando...</> : '📡 Cargar datos del Mundial 2026'}
            </button>
          </div>
        )}

        {/* Load log */}
        {loadLog.length > 0 && (
          <div style={{
            marginTop: 12, background: '#050c18', borderRadius: 8, padding: '12px 14px',
            fontFamily: 'monospace', fontSize: 12, color: '#5a7a9a', lineHeight: 2,
            border: '1px solid #0d1a28',
          }}>
            {loadLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

      {/* ── Odds API (cuotas de casas de apuestas) ── */}
      <div className="card">
        <SectionTitle sub="Opcional · Compara tus pronósticos contra el mercado real">
          🎰 Cuotas · The Odds API
        </SectionTitle>

        <div style={{
          background: '#0A1225', border: '1px solid #162844', borderRadius: 8,
          padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#5a7a9a', lineHeight: 1.9,
        }}>
          <div style={{ color: '#7AACCC', fontWeight: 600, marginBottom: 6 }}>Cómo obtener tu token:</div>
          <div>1. Ve a <a href="https://the-odds-api.com/" target="_blank" rel="noreferrer"
              style={{ color: '#00D4AA' }}>the-odds-api.com</a> y crea una cuenta gratis</div>
          <div>2. Copia tu API key del panel (tier gratuito: 500 solicitudes/mes)</div>
          <div>3. Pégala abajo y prueba la conexión</div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div className="label-sm" style={{ marginBottom: 6 }}>Tu Odds API Token</div>
          <input
            type="text"
            placeholder="p.ej. 9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c"
            value={oddsKey}
            onChange={e => { setOddsKeyInput(e.target.value); setOddsTestStatus(null); }}
            style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}
          />
          {hasOddsApiKey() && !oddsKey.trim() && (
            <div style={{ fontSize: 11, color: '#3a5070', marginTop: 4 }}>
              Key guardada: {getMaskedOddsKey()}
            </div>
          )}
        </div>

        <button
          className="btn-primary"
          onClick={handleSaveAndTestOdds}
          disabled={!oddsKey.trim() || oddsTestStatus === 'testing'}
          style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
        >
          {oddsTestStatus === 'testing'
            ? <><Spinner size={15} /> Probando conexión...</>
            : '💾 Guardar y probar conexión'}
        </button>

        {oddsTestStatus && oddsTestStatus !== 'testing' && (
          <div style={{
            padding: '12px 16px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
            background: oddsTestStatus.ok ? '#0d2e1e' : '#2e0d0d',
            border: `1px solid ${oddsTestStatus.ok ? '#1a4a2e' : '#4a1a1a'}`,
            color: oddsTestStatus.ok ? '#3FB950' : '#F85149',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {oddsTestStatus.ok ? '✅ Conexión exitosa' : '❌ Error de conexión'}
            </div>
            <div style={{ fontSize: 12, color: oddsTestStatus.ok ? '#2a8040' : '#c04040' }}>
              {oddsTestStatus.message}
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid #162844', marginTop: 16, paddingTop: 16 }}>
          <button className="btn-secondary" onClick={handleClearOddsCache}>
            {oddsCacheCleared ? '✅ Caché de cuotas limpiada' : '🗑 Limpiar caché de cuotas'}
          </button>
          <div style={{ fontSize: 11, color: '#3a5070', marginTop: 10, lineHeight: 1.7 }}>
            Las cuotas se cachean 1 hora para cuidar la cuota mensual gratuita.
            Solo se muestran cuando hay un partido próximo con mercado abierto —
            es normal no encontrar cuotas para partidos lejanos en el calendario.
          </div>
        </div>
      </div>

      {/* ── API-Football (cobertura ampliada de competencias) ── */}
      <div className="card">
        <SectionTitle sub="Opcional · Cubre AFCON, Copa América, Gold Cup y clasificatorias que football-data.org no incluye">
          🌍 Cobertura ampliada · API-Football
        </SectionTitle>

        <div style={{
          background: '#0A1225', border: '1px solid #162844', borderRadius: 8,
          padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#5a7a9a', lineHeight: 1.9,
        }}>
          <div style={{ color: '#7AACCC', fontWeight: 600, marginBottom: 6 }}>¿Por qué agregar esto?</div>
          <div>
            El tier gratuito de football-data.org solo cubre 12 ligas/torneos
            (Mundial, Champions, 5 grandes ligas europeas, etc.). Si un equipo
            fue dominante en la <strong style={{ color: '#D8E6F3' }}>Copa Africana</strong>,
            la <strong style={{ color: '#D8E6F3' }}>Copa América</strong> o la <strong style={{ color: '#D8E6F3' }}>Gold Cup</strong>,
            esos partidos son invisibles para el modelo sin esta fuente adicional.
          </div>
          <div style={{ marginTop: 8, color: '#7AACCC', fontWeight: 600 }}>Cómo obtener tu token:</div>
          <div>1. Ve a <a href="https://www.api-football.com/" target="_blank" rel="noreferrer"
              style={{ color: '#00D4AA' }}>api-football.com</a> y crea una cuenta gratis</div>
          <div>2. Copia tu API key del dashboard (tier gratuito: 100 solicitudes/día)</div>
          <div>3. Pégala abajo y prueba la conexión</div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div className="label-sm" style={{ marginBottom: 6 }}>Tu API-Football Token</div>
          <input
            type="text"
            placeholder="p.ej. a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
            value={afKey}
            onChange={e => { setAfKeyInput(e.target.value); setAfTestStatus(null); }}
            style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}
          />
          {hasApiFootballKey() && !afKey.trim() && (
            <div style={{ fontSize: 11, color: '#3a5070', marginTop: 4 }}>
              Key guardada: {getMaskedApiFootballKey()}
            </div>
          )}
        </div>

        <button
          className="btn-primary"
          onClick={handleSaveAndTestAf}
          disabled={!afKey.trim() || afTestStatus === 'testing'}
          style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
        >
          {afTestStatus === 'testing'
            ? <><Spinner size={15} /> Probando conexión...</>
            : '💾 Guardar y probar conexión'}
        </button>

        {afTestStatus && afTestStatus !== 'testing' && (
          <div style={{
            padding: '12px 16px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
            background: afTestStatus.ok ? '#0d2e1e' : '#2e0d0d',
            border: `1px solid ${afTestStatus.ok ? '#1a4a2e' : '#4a1a1a'}`,
            color: afTestStatus.ok ? '#3FB950' : '#F85149',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {afTestStatus.ok ? '✅ Conexión exitosa' : '❌ Error de conexión'}
            </div>
            <div style={{ fontSize: 12, color: afTestStatus.ok ? '#2a8040' : '#c04040' }}>
              {afTestStatus.message}
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid #162844', marginTop: 16, paddingTop: 16 }}>
          <button className="btn-secondary" onClick={handleClearAfCache}>
            {afCacheCleared ? '✅ Caché limpiada' : '🗑 Limpiar caché de API-Football'}
          </button>
          <div style={{ fontSize: 11, color: '#3a5070', marginTop: 10, lineHeight: 1.7 }}>
            Una vez configurada, esta fuente se usa automáticamente al predecir
            cualquier partido — los partidos se combinan con football-data.org
            y se eliminan duplicados automáticamente. Verás cuántos partidos
            vinieron de cada fuente en el panel "🔍 Calidad de datos" de cada
            pronóstico.
          </div>
        </div>
      </div>

      {/* ── Simulaciones ── */}
      <div className="card">
        <SectionTitle sub="Mayor número = más preciso pero más lento">
          🎲 Simulaciones Monte Carlo
        </SectionTitle>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: '#7AACCC' }}>Número de simulaciones</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#00D4AA', fontSize: 16 }}>
            {simCount.toLocaleString()}
          </span>
        </div>
        <input type="range" min="10000" max="50000" step="5000"
          value={simCount} onChange={e => setSimCount(Number(e.target.value))} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#3a5070', marginTop: 6 }}>
          <span>10,000 (rápido)</span>
          <span>50,000 (preciso)</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 12 }}>
          {[10000, 20000, 30000, 40000, 50000].map(n => (
            <button key={n} onClick={() => setSimCount(n)} style={{
              padding: '6px 4px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              border: `1px solid ${simCount === n ? '#00D4AA' : '#162844'}`,
              background: simCount === n ? '#112038' : 'transparent',
              color: simCount === n ? '#00D4AA' : '#5a7a9a', fontFamily: 'monospace',
            }}>
              {(n / 1000).toFixed(0)}K
            </button>
          ))}
        </div>
      </div>

      {/* ── Caché ── */}
      <div className="card">
        <SectionTitle sub="Los datos se guardan en tu navegador para reducir llamadas a la API">
          💾 Caché y datos
        </SectionTitle>
        <button className="btn-secondary" onClick={handleClearCache}>
          {cacheCleared ? '✅ Caché limpiada' : '🗑 Limpiar caché'}
        </button>
        <div style={{ fontSize: 12, color: '#3a5070', marginTop: 10, lineHeight: 1.7 }}>
          TTL: equipos (24h) · partidos WC (2h) · historial por equipo (7d)
        </div>
      </div>

      {/* ── Acerca de ── */}
      <div className="card">
        <SectionTitle>📌 Sobre esta app</SectionTitle>
        <div style={{ fontSize: 13, color: '#5a7a9a', lineHeight: 1.9 }}>
          <div>• <strong style={{ color: '#7AACCC' }}>Modelos:</strong> Poisson+Dixon-Coles · ELO (K=40 WC) · Forma reciente · xG proxy · ML ligero · Ranking FIFA</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Ensemble:</strong> Promedio ponderado de lambdas + Monte Carlo en lotes</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Std Dev:</strong> 10 lotes de simulación → varianza real</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Sin datos:</strong> La app funciona sin API key con datos estadísticos base</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Privacidad:</strong> Todo corre en tu navegador · Sin servidores propios</div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#3a5070' }}>
            Solo para entretenimiento · No es consejo de apuestas
          </div>
        </div>
      </div>
    </div>
  );
}

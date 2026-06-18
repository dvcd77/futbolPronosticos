import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { SectionTitle, ErrorBox, Spinner } from '../ui/Shared.jsx';
import { testApiKey, clearCache, getMaskedKey, hasApiKey } from '../../api/footballApi.js';
import { fetchTeams, fetchCompetitionMatches } from '../../api/footballApi.js';
import { buildEloRatings } from '../../models/elo.js';
import { FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { DEFAULT_WEIGHTS } from '../../models/ensemble.js';

export default function Settings() {
  const { simCount, setSimCount, weights, setWeights, setTeams, setEloRatings, setTeamMatchCache, setApiStatus } = useApp();

  const [apiKey, setApiKey] = useState(localStorage.getItem('fdapi_key') ?? '');
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | 'ok' | 'fail'
  const [loadingData, setLoadingData] = useState(false);
  const [loadStatus, setLoadStatus] = useState('');
  const [saved, setSaved] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  async function handleTestKey() {
    if (!apiKey.trim()) return;
    setTestStatus('testing');
    const ok = await testApiKey(apiKey.trim());
    setTestStatus(ok ? 'ok' : 'fail');
    setApiStatus({ ok, queue: 0 });
  }

  function handleSaveKey() {
    if (!apiKey.trim()) return;
    localStorage.setItem('fdapi_key', apiKey.trim());
    setSaved(true);
    setApiStatus(prev => ({ ...prev, ok: true }));
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleLoadTeams() {
    setLoadingData(true);
    setLoadStatus('Cargando equipos del Mundial 2026...');
    try {
      const teamList = await fetchTeams('WC');
      if (teamList.length > 0) {
        setTeams(teamList);
        setLoadStatus(`✅ ${teamList.length} equipos cargados.`);
      } else {
        setTeams(FALLBACK_TEAMS);
        setLoadStatus('ℹ️ Usando lista de equipos predeterminada.');
      }
    } catch (e) {
      setTeams(FALLBACK_TEAMS);
      setLoadStatus(`⚠️ Error: ${e.message}. Usando equipos predeterminados.`);
    }

    // Try to load WC 2026 matches for ELO
    try {
      setLoadStatus(prev => prev + '\nCargando partidos del Mundial...');
      const matches = await fetchCompetitionMatches('WC', 2026);
      if (matches.length > 0) {
        const elo = buildEloRatings(matches);
        setEloRatings(elo);
        setLoadStatus(prev => prev + `\n✅ ${matches.length} partidos cargados, ELO calculado.`);
      }
    } catch (e) {
      setLoadStatus(prev => prev + `\nℹ️ Partidos WC: ${e.message}`);
    }

    setLoadingData(false);
  }

  function handleClearCache() {
    clearCache();
    setTeamMatchCache({});
    setEloRatings(new Map());
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 2000);
  }

  function handleResetWeights() {
    setWeights(DEFAULT_WEIGHTS);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* API Key */}
      <div className="card">
        <SectionTitle sub="Regístrate gratis en football-data.org para obtener tu API key">
          🔑 API Key · football-data.org
        </SectionTitle>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="password"
            placeholder="Pega tu API key aquí..."
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setTestStatus(null); setSaved(false); }}
          />
          <button className="btn-secondary" onClick={handleTestKey} disabled={!apiKey.trim() || testStatus === 'testing'}
            style={{ whiteSpace: 'nowrap' }}>
            {testStatus === 'testing' ? <Spinner size={14} /> : 'Probar'}
          </button>
          <button className="btn-primary" onClick={handleSaveKey} disabled={!apiKey.trim()}
            style={{ whiteSpace: 'nowrap', padding: '8px 16px' }}>
            {saved ? '✅' : 'Guardar'}
          </button>
        </div>

        {testStatus === 'ok' && (
          <div style={{ color: '#3FB950', fontSize: 13 }}>✅ Conexión exitosa · API key válida</div>
        )}
        {testStatus === 'fail' && (
          <div style={{ color: '#F85149', fontSize: 13 }}>❌ API key inválida o sin permisos</div>
        )}
        {hasApiKey() && !testStatus && (
          <div style={{ color: '#5a7a9a', fontSize: 12 }}>Key guardada: {getMaskedKey()}</div>
        )}

        <div style={{ borderTop: '1px solid #162844', marginTop: 16, paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: '#5a7a9a', marginBottom: 12, lineHeight: 1.6 }}>
            ℹ️ <strong style={{ color: '#7AACCC' }}>Tier gratuito incluye:</strong> equipos, partidos, standings y goleadores
            del Mundial 2026 (WC), Eurocopa, Champions League y ligas principales.
            Límite: 10 solicitudes/minuto (la app respeta esto automáticamente).
          </div>
          <button className="btn-secondary" onClick={handleLoadTeams} disabled={loadingData || !hasApiKey()}>
            {loadingData ? <><Spinner size={14} /> Cargando...</> : '📡 Cargar datos del Mundial 2026'}
          </button>
          {loadStatus && (
            <pre style={{ fontSize: 11, color: '#5a7a9a', marginTop: 10, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {loadStatus}
            </pre>
          )}
        </div>
      </div>

      {/* Simulation count */}
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
              color: simCount === n ? '#00D4AA' : '#5a7a9a',
              fontFamily: 'monospace',
            }}>
              {(n / 1000).toFixed(0)}K
            </button>
          ))}
        </div>
      </div>

      {/* Cache management */}
      <div className="card">
        <SectionTitle sub="Los datos se almacenan en tu navegador para reducir llamadas a la API">
          💾 Caché y datos
        </SectionTitle>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleClearCache}>
            {cacheCleared ? '✅ Caché limpiada' : '🗑 Limpiar caché'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#3a5070', marginTop: 12, lineHeight: 1.6 }}>
          La caché almacena: equipos (24h), partidos del WC (2h), historial por equipo (7d).
          Limpiar la caché fuerza la recarga de todos los datos desde la API.
        </div>
      </div>

      {/* About */}
      <div className="card">
        <SectionTitle>📌 Sobre esta app</SectionTitle>
        <div style={{ fontSize: 13, color: '#5a7a9a', lineHeight: 1.8 }}>
          <div>• <strong style={{ color: '#7AACCC' }}>Modelos:</strong> Poisson+Dixon-Coles, ELO (K=40 WC), Forma reciente, xG aproximado, ML ligero</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Ensemble:</strong> Promedio ponderado de lambdas + Monte Carlo</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Std Dev:</strong> Calculada corriendo simulaciones en 10 lotes</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Datos:</strong> football-data.org · 6 años de historial</div>
          <div>• <strong style={{ color: '#7AACCC' }}>Privacidad:</strong> Todo corre en tu navegador · Ningún dato sale excepto a la API</div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#3a5070' }}>
            Pronosticador Mundial 2026 · IA estadística · Solo para entretenimiento
          </div>
        </div>
      </div>
    </div>
  );
}

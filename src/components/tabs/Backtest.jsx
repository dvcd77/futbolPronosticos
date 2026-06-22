import { useState } from 'react';
import { useApp, FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { SectionTitle, ErrorBox, InfoBox, Spinner, EmptyState } from '../ui/Shared.jsx';
import { runBacktest } from '../../models/backtest.js';
import { MODEL_LABELS } from '../../models/ensemble.js';

const MODEL_COLORS = {
  poisson: '#00D4AA', elo: '#7AACCC', form: '#F5A623', xg: '#BC8CFF',
  fifa: '#FFD700', confShrink: '#FF8FB1', h2h: '#5FD3F3', ensemble: '#F85149',
};

// Métrica → descripción corta para los tooltips/leyenda
const METRIC_INFO = {
  rps: 'Ranked Probability Score — la métrica principal. Sensible al orden (un empate está más cerca de victoria local que de visitante). Menor = mejor.',
  accuracy: 'Porcentaje de partidos donde el resultado más probable del modelo fue el correcto. Útil pero ignora la confianza.',
  logLoss: 'Penaliza fuertemente la sobreconfianza (predecir 95% algo que no pasó). Menor = mejor.',
};

function MetricBar({ value, max, color, lowerIsBetter = true }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ background: '#162844', borderRadius: 3, height: 5, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width .6s' }} />
    </div>
  );
}

export default function Backtest() {
  const { teams, teamMatchCache, eloRatings } = useApp();
  const displayTeams = teams.length > 0 ? teams : FALLBACK_TEAMS;

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Reúne todos los partidos cacheados (de las precargas / predicciones)
  function gatherAllMatches() {
    const all = [];
    const seen = new Set();
    Object.values(teamMatchCache).flat().forEach(m => {
      if (m.id && !seen.has(m.id)) { seen.add(m.id); all.push(m); }
    });
    return all;
  }

  async function handleRunBacktest() {
    setError(''); setResult(null); setRunning(true);
    setProgress({ current: 0, total: 0 });

    const matches = gatherAllMatches();
    if (matches.length < 40) {
      setError(`Solo hay ${matches.length} partidos en caché. Ve a ⚙️ Configuración y usa "Precargar los 48 equipos" para tener suficiente historial (idealmente 100+ partidos).`);
      setRunning(false);
      return;
    }

    try {
      // Pequeño respiro para que la UI pinte el spinner antes del trabajo pesado
      await new Promise(r => setTimeout(r, 50));
      const res = await runBacktest(matches, displayTeams, {
        warmup: 30,
        onProgress: p => setProgress(p),
      });
      if (res.error) {
        setError(res.error);
      } else {
        setResult(res);
      }
    } catch (e) {
      setError(e.message ?? 'Error al ejecutar el backtest.');
    } finally {
      setRunning(false);
    }
  }

  // Ordena modelos por RPS (mejor primero) para el ranking
  const rankedModels = result
    ? Object.entries(result.perModel)
        .filter(([, m]) => m.rps != null)
        .sort((a, b) => a[1].rps - b[1].rps)
    : [];

  const baselineRps = result?.baseline?.rps;
  const worstRps = rankedModels.length ? Math.max(...rankedModels.map(([, m]) => m.rps), baselineRps ?? 0) : 1;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="card" style={{ marginBottom: 20 }}>
        <SectionTitle sub="Mide objetivamente qué tan bien predice cada modelo sobre partidos históricos reales — sin esto, cambiar el modelo es a ciegas">
          🔬 Validación histórica (backtesting)
        </SectionTitle>

        <div style={{
          background: '#0A1225', border: '1px solid #162844', borderRadius: 8,
          padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#5a7a9a', lineHeight: 1.8,
        }}>
          Para cada partido histórico, se reconstruye el pronóstico que cada modelo
          <strong style={{ color: '#7AACCC' }}> habría hecho usando solo datos anteriores</strong> a
          ese partido (sin ver el futuro), y se compara con el resultado real usando el
          <strong style={{ color: '#D8E6F3' }}> RPS</strong> (Ranked Probability Score), el estándar
          en la literatura de pronóstico futbolístico. Menor RPS = mejores predicciones.
        </div>

        <button
          className="btn-primary"
          onClick={handleRunBacktest}
          disabled={running}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {running
            ? <><Spinner size={15} /> Evaluando {progress.current}/{progress.total} partidos…</>
            : '🔬 Ejecutar validación sobre partidos en caché'}
        </button>

        {running && progress.total > 0 && (
          <div style={{ marginTop: 10, background: '#162844', borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{
              width: `${(progress.current / Math.max(progress.total, 1)) * 100}%`,
              height: '100%', background: '#00D4AA', transition: 'width 0.3s',
            }} />
          </div>
        )}

        <ErrorBox message={error} />
      </div>

      {!result && !running && !error && (
        <EmptyState icon="🔬" title="Ejecuta una validación para ver el rendimiento de cada modelo"
          sub="Necesitas partidos en caché — precarga los 48 equipos en Configuración para mejores resultados" />
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Resumen */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="label-sm">Partidos evaluados</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#D8E6F3', fontFamily: 'monospace' }}>{result.testCount}</div>
              </div>
              <div>
                <div className="label-sm">Mejor modelo</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: MODEL_COLORS[rankedModels[0]?.[0]] ?? '#D8E6F3' }}>
                  {MODEL_LABELS[rankedModels[0]?.[0]] ?? '—'}
                </div>
              </div>
              <div>
                <div className="label-sm">Su RPS</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#3FB950', fontFamily: 'monospace' }}>
                  {rankedModels[0]?.[1].rps.toFixed(4) ?? '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Ranking por modelo */}
          <div className="card">
            <SectionTitle sub="Ordenados por RPS (menor = mejor). La barra muestra el RPS relativo al peor.">
              Rendimiento por modelo
            </SectionTitle>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {rankedModels.map(([id, m], idx) => {
                const beatsBaseline = baselineRps != null && m.rps < baselineRps;
                return (
                  <div key={id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: '#3a5070', fontFamily: 'monospace', width: 18 }}>#{idx + 1}</span>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: MODEL_COLORS[id] }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: id === 'ensemble' ? MODEL_COLORS[id] : '#D8E6F3' }}>
                          {MODEL_LABELS[id]}
                        </span>
                        {!beatsBaseline && (
                          <span style={{ fontSize: 9, color: '#F5A623' }}>⚠ no supera baseline</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: MODEL_COLORS[id] }}>
                          {m.rps.toFixed(4)}
                        </span>
                        <span style={{ fontSize: 11, color: '#5a7a9a', fontFamily: 'monospace', width: 48, textAlign: 'right' }}>
                          {(m.accuracy * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <MetricBar value={m.rps} max={worstRps} color={MODEL_COLORS[id]} />
                  </div>
                );
              })}
            </div>

            {/* Baseline reference line */}
            {baselineRps != null && (
              <div style={{ borderTop: '1px solid #162844', marginTop: 14, paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, color: '#5a7a9a' }}>
                    📏 Baseline ingenuo <span style={{ color: '#3a5070' }}>(siempre 40/27/33%)</span>
                  </span>
                  <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#5a7a9a' }}>{baselineRps.toFixed(4)}</span>
                </div>
                <div style={{ fontSize: 10, color: '#3a5070', marginTop: 6, lineHeight: 1.6 }}>
                  Cualquier modelo con RPS menor que el baseline está aportando información real.
                  Los que no lo superan deberían tener poco o ningún peso en el ensemble.
                </div>
              </div>
            )}
          </div>

          {/* Interpretación / siguiente paso */}
          <div className="card">
            <SectionTitle>¿Cómo usar esto?</SectionTitle>
            <div style={{ fontSize: 12, color: '#5a7a9a', lineHeight: 1.9 }}>
              <div style={{ marginBottom: 8 }}>
                • Los modelos con <strong style={{ color: '#3FB950' }}>menor RPS</strong> son los que más aciertan
                ponderando confianza — merecen <strong>más peso</strong> en el ensemble (ajústalo en 🎯 Pronóstico → Pesos del modelo).
              </div>
              <div style={{ marginBottom: 8 }}>
                • Los marcados <span style={{ color: '#F5A623' }}>⚠ no supera baseline</span> están aportando
                ruido más que señal en este conjunto de datos — considera bajarles el peso.
              </div>
              <div style={{ marginBottom: 8 }}>
                • El modelo <strong style={{ color: '#3FB950' }}>Mercado</strong> no aparece aquí porque no tenemos
                cuotas históricas archivadas para backtestear — pero la literatura confirma que suele ser
                el más difícil de superar.
              </div>
              <div>
                • Cuantos <strong>más partidos en caché</strong>, más confiable la medición. Con pocos partidos,
                pequeñas diferencias de RPS no son significativas.
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#3a5070', textAlign: 'center', lineHeight: 1.6 }}>
            RPS típico en la literatura: ~0.19 (excelente, nivel mercado) a ~0.21 (bueno).
            El baseline ingenuo ronda 0.22-0.24. Valores muy por debajo de 0.18 sobre pocos
            partidos suelen indicar sobreajuste, no genialidad.
          </div>
        </div>
      )}
    </div>
  );
}

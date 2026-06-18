import { useState, useCallback } from 'react';
import { useApp, FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { TeamSelector, ProbBar, SectionTitle, ErrorBox, InfoBox, Spinner, EmptyState } from '../ui/Shared.jsx';
import ScoreMatrix from '../ui/ScoreMatrix.jsx';
import ModelWeights from '../ui/ModelWeights.jsx';
import { teamStrengthFromMatches, expectedGoals as poissonEG, poissonPrediction } from '../../models/poisson.js';
import { buildEloRatings, eloPrediction } from '../../models/elo.js';
import { formPrediction, formDisplay } from '../../models/form.js';
import { xgPrediction } from '../../models/xg.js';
import { mlPrediction } from '../../models/ml.js';
import { ensemblePrediction, MODEL_IDS, MODEL_LABELS } from '../../models/ensemble.js';
import { runMonteCarlo } from '../../models/monteCarlo.js';
import { fetchTeamMatches, fetchCompetitionMatches, hasApiKey } from '../../api/footballApi.js';
import { BarChart, Bar, XAxis, YAxis, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const MODEL_COLORS = { poisson:'#00D4AA', elo:'#7AACCC', form:'#F5A623', xg:'#BC8CFF', ml:'#3FB950', ensemble:'#F85149' };

function useTeamData() {
  const { teamMatchCache, setTeamMatchCache, eloRatings, setEloRatings, setApiStatus } = useApp();

  const loadTeamData = useCallback(async (teamId) => {
    if (teamMatchCache[teamId]) return teamMatchCache[teamId];
    if (!hasApiKey()) return [];
    try {
      const matches = await fetchTeamMatches(teamId);
      setTeamMatchCache(prev => ({ ...prev, [teamId]: matches }));

      // Rebuild ELO from all cached matches
      const allMatches = [...Object.values(teamMatchCache).flat(), ...matches];
      const newElo = buildEloRatings(allMatches);
      setEloRatings(newElo);
      setApiStatus(prev => ({ ...prev, ok: true }));
      return matches;
    } catch (e) {
      setApiStatus(prev => ({ ...prev, ok: false }));
      return [];
    }
  }, [teamMatchCache, setTeamMatchCache, setEloRatings, setApiStatus]);

  return { loadTeamData, teamMatchCache };
}

export default function MatchPredictor() {
  const { teams, weights, setWeights, simCount, addToHistory, eloRatings } = useApp();
  const displayTeams = teams.length > 0 ? teams : FALLBACK_TEAMS;
  const { loadTeamData, teamMatchCache } = useTeamData();

  const [homeId, setHomeId] = useState(null);
  const [awayId, setAwayId] = useState(null);
  const [activeModel, setActiveModel] = useState('ensemble');
  const [weightsMode, setWeightsMode] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [allModelResults, setAllModelResults] = useState(null);
  const [showWeights, setShowWeights] = useState(false);
  const [saved, setSaved] = useState(false);

  const homeTeam = displayTeams.find(t => t.id === homeId);
  const awayTeam = displayTeams.find(t => t.id === awayId);

  async function runPrediction() {
    if (!homeId || !awayId) { setError('Selecciona ambos equipos.'); return; }
    if (homeId === awayId) { setError('Los equipos no pueden ser el mismo.'); return; }
    setError(''); setLoading(true); setResult(null); setSaved(false);

    try {
      const [homeMatches, awayMatches] = await Promise.all([
        loadTeamData(homeId),
        loadTeamData(awayId),
      ]);

      const useStaticFallback = homeMatches.length === 0 && awayMatches.length === 0;

      // Compute all models
      const models = {};

      // Poisson
      const homeStr = teamStrengthFromMatches(homeMatches, homeId);
      const awayStr = teamStrengthFromMatches(awayMatches, awayId);
      const { lambdaHome: lH_p, lambdaAway: lA_p } = poissonEG(homeStr, awayStr);
      models.poisson = poissonPrediction(lH_p, lA_p);

      // ELO
      const eloR = eloRatings.size > 0 ? eloRatings : buildEloRatings([...homeMatches, ...awayMatches]);
      models.elo = eloPrediction(homeId, awayId, eloR);

      // Form
      if (homeMatches.length > 0 || awayMatches.length > 0) {
        models.form = formPrediction(homeMatches, awayMatches, homeId, awayId);
        models.xg   = xgPrediction(homeMatches, awayMatches, homeId, awayId, eloR);
        models.ml   = mlPrediction(homeMatches, awayMatches, homeId, awayId, eloR);
      } else {
        models.form = models.elo;
        models.xg   = models.elo;
        models.ml   = models.elo;
      }

      // Ensemble with Monte Carlo
      const effWeights = weightsMode === 'auto'
        ? Object.fromEntries(MODEL_IDS.map(id => [id, 1 / MODEL_IDS.length]))
        : weights;

      models.ensemble = ensemblePrediction(models, effWeights, simCount);

      // Also run MC on the active model's lambdas for std dev display
      const active = models[activeModel] ?? models.ensemble;
      const mcResult = activeModel === 'ensemble'
        ? models.ensemble
        : runMonteCarlo(active.lambdaHome ?? lH_p, active.lambdaAway ?? lA_p, simCount);

      setAllModelResults(models);
      setResult({ ...mcResult, model: activeModel, useStaticFallback });
    } catch (e) {
      setError(e.message ?? 'Error al calcular el pronóstico.');
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    if (!result || !homeTeam || !awayTeam) return;
    addToHistory({
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      homeId, awayId,
      model: activeModel,
      result,
      date: new Date().toISOString(),
    });
    setSaved(true);
  }

  function switchModel(modelId) {
    setActiveModel(modelId);
    if (!allModelResults) return;
    const m = allModelResults[modelId];
    if (!m) return;
    const mcRes = modelId === 'ensemble'
      ? m
      : runMonteCarlo(m.lambdaHome ?? 1.3, m.lambdaAway ?? 1.3, simCount);
    setResult({ ...mcRes, model: modelId, useStaticFallback: result?.useStaticFallback });
  }

  // Build chart data for probability chart
  const chartData = result ? [
    { name: homeTeam?.shortName ?? homeTeam?.tla ?? 'Local', prob: Math.round(result.home * 1000) / 10, fill: '#00D4AA' },
    { name: 'Empate', prob: Math.round(result.draw * 1000) / 10, fill: '#7AACCC' },
    { name: awayTeam?.shortName ?? awayTeam?.tla ?? 'Visitante', prob: Math.round(result.away * 1000) / 10, fill: '#F5A623' },
  ] : [];

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: '#0D172E', border: '1px solid #1C3254', borderRadius: 6, padding: '8px 12px' }}>
        <div style={{ fontFamily: 'monospace', fontWeight: 700, color: payload[0].fill }}>
          {payload[0].value}%
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)', gap: 20 }}
        className="lg:grid-cols-[380px_1fr] md:grid-cols-1">

        {/* ── Left panel: Controls ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <SectionTitle>Selección de equipos</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <TeamSelector teams={displayTeams} value={homeId} onChange={setHomeId}
                label="🏠 Equipo Local" excludeId={awayId} />
              <div style={{ textAlign: 'center', color: '#3a5070', fontSize: 18, fontWeight: 700 }}>vs</div>
              <TeamSelector teams={displayTeams} value={awayId} onChange={setAwayId}
                label="✈️ Equipo Visitante" excludeId={homeId} />
            </div>
          </div>

          {/* Model selector */}
          <div className="card">
            <SectionTitle>Modelo de predicción</SectionTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {[...MODEL_IDS, 'ensemble'].map(id => (
                <button key={id} onClick={() => { setActiveModel(id); if (allModelResults) switchModel(id); }}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', border: '1px solid',
                    background: activeModel === id ? '#112038' : 'transparent',
                    borderColor: activeModel === id ? MODEL_COLORS[id] : '#162844',
                    color: activeModel === id ? MODEL_COLORS[id] : '#5a7a9a',
                    transition: 'all 0.15s',
                  }}>
                  {MODEL_LABELS[id] ?? 'Ensemble'}
                </button>
              ))}
            </div>

            {/* Ensemble weights */}
            {activeModel === 'ensemble' && (
              <div>
                <button onClick={() => setShowWeights(!showWeights)} style={{
                  fontSize: 12, color: '#5a7a9a', background: 'transparent',
                  border: 'none', cursor: 'pointer', padding: 0, marginBottom: showWeights ? 12 : 0,
                }}>
                  {showWeights ? '▼' : '▶'} Configurar pesos ensemble
                </button>
                {showWeights && (
                  <ModelWeights weights={weights} onChange={setWeights}
                    mode={weightsMode} onModeChange={setWeightsMode} />
                )}
              </div>
            )}
          </div>

          {/* Simulation count */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <SectionTitle>Simulaciones Monte Carlo</SectionTitle>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#00D4AA', fontWeight: 700 }}>
                {simCount.toLocaleString()}
              </span>
            </div>
            <input type="range" min="10000" max="50000" step="5000"
              value={simCount}
              onChange={e => { /* simCount is global in context */ }}
              style={{ opacity: 0.5 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#3a5070', marginTop: 4 }}>
              <span>10K</span><span>50K</span>
            </div>
            <div style={{ fontSize: 11, color: '#3a5070', marginTop: 6 }}>
              Ajusta en ⚙️ Configuración
            </div>
          </div>

          <button className="btn-primary" onClick={runPrediction} disabled={loading || !homeId || !awayId}
            style={{ width: '100%', justifyContent: 'center', fontSize: 15, padding: '14px' }}>
            {loading ? <><Spinner size={16} /> Calculando...</> : '⚽ Predecir partido'}
          </button>

          <ErrorBox message={error} />
          {result?.useStaticFallback && (
            <InfoBox message="Usando datos estadísticos base (sin historial de API). Agrega tu API key en ⚙️ Configuración para mayor precisión." />
          )}
        </div>

        {/* ── Right panel: Results ────────────────────────────────────────── */}
        <div>
          {!result ? (
            <div className="card" style={{ minHeight: 400 }}>
              <EmptyState icon="🎯" title="Selecciona dos equipos y pulsa Predecir"
                sub="Los modelos analizarán datos históricos para generar probabilidades con intervalos de confianza" />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Match header */}
              <div className="card" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#00D4AA' }}>{homeTeam?.name}</div>
                    <div style={{ fontSize: 11, color: '#3a5070', marginTop: 2 }}>xG: {result.lambdaHome?.toFixed(2)}</div>
                  </div>
                  <div style={{ fontSize: 24, color: '#3a5070', fontWeight: 700 }}>VS</div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#F5A623' }}>{awayTeam?.name}</div>
                    <div style={{ fontSize: 11, color: '#3a5070', marginTop: 2 }}>xG: {result.lambdaAway?.toFixed(2)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#5a7a9a', fontFamily: 'monospace' }}>
                      {MODEL_LABELS[result.model] ?? 'Ensemble'} · {result.totalSims?.toLocaleString() ?? simCount.toLocaleString()} sims
                    </span>
                    <button className="btn-secondary" onClick={handleSave} disabled={saved}
                      style={{ fontSize: 12, padding: '6px 12px' }}>
                      {saved ? '✅ Guardado' : '💾 Guardar'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* 1X2 probabilities */}
                <div className="card">
                  <SectionTitle>Resultado final (1X2)</SectionTitle>
                  <div style={{ height: 140, marginBottom: 12 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barSize={48}>
                        <XAxis dataKey="name" tick={{ fill: '#5a7a9a', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: '#3a5070', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="prob" radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                    {[
                      { label: homeTeam?.tla ?? 'L', val: result.home, std: result.stdDev?.home, color: '#00D4AA' },
                      { label: 'X', val: result.draw, std: result.stdDev?.draw, color: '#7AACCC' },
                      { label: awayTeam?.tla ?? 'V', val: result.away, std: result.stdDev?.away, color: '#F5A623' },
                    ].map(({ label, val, std, color }) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#5a7a9a', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color }}>
                          {(val * 100).toFixed(1)}%
                        </div>
                        {std != null && <div className="std-badge">±{(std * 100).toFixed(1)}%</div>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Over / Under */}
                <div className="card">
                  <SectionTitle>Goles totales</SectionTitle>
                  {[
                    { label: 'Más de 1.5 goles', val: result.over?.['1.5'], std: result.overStd?.['1.5'], color: '#3FB950' },
                    { label: 'Más de 2.5 goles', val: result.over?.['2.5'], std: result.overStd?.['2.5'], color: '#3FB950' },
                    { label: 'Más de 3.5 goles', val: result.over?.['3.5'], std: result.overStd?.['3.5'], color: '#3FB950' },
                    { label: 'Ambos anotan', val: result.btts, std: result.bttsStd, color: '#BC8CFF' },
                  ].map(({ label, val, std, color }) => val != null && (
                    <ProbBar key={label} label={label} value={val} std={std} color={color} height={6} />
                  ))}

                  <div style={{ borderTop: '1px solid #162844', marginTop: 12, paddingTop: 12 }}>
                    <SectionTitle sub="">Medio tiempo</SectionTitle>
                    {[
                      { label: homeTeam?.shortName ?? 'Local', val: result.halfTime?.home, std: result.halfTimeStd?.home, color: '#00D4AA' },
                      { label: 'Empate HT', val: result.halfTime?.draw, std: result.halfTimeStd?.draw, color: '#7AACCC' },
                      { label: awayTeam?.shortName ?? 'Visitante', val: result.halfTime?.away, std: result.halfTimeStd?.away, color: '#F5A623' },
                    ].map(({ label, val, std, color }) => val != null && (
                      <ProbBar key={label} label={label} value={val} std={std} color={color} height={5} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Score matrix */}
              <div className="card">
                <SectionTitle sub="Probabilidad de cada marcador exacto">
                  Matriz de marcadores
                </SectionTitle>
                <ScoreMatrix
                  scores={result.scores}
                  homeLabel={homeTeam?.shortName ?? 'Local'}
                  awayLabel={awayTeam?.shortName ?? 'Visitante'}
                />
              </div>

              {/* Model quick-switch */}
              {allModelResults && (
                <div className="card">
                  <SectionTitle sub="Haz clic para ver el pronóstico de cada modelo">Comparar modelos rápido</SectionTitle>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {[...MODEL_IDS, 'ensemble'].map(id => {
                      const m = allModelResults[id];
                      if (!m) return null;
                      return (
                        <button key={id} onClick={() => switchModel(id)} style={{
                          padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${result.model === id ? MODEL_COLORS[id] : '#1C3254'}`,
                          background: result.model === id ? '#112038' : '#0A1225',
                          textAlign: 'left', minWidth: 110,
                        }}>
                          <div style={{ fontSize: 11, color: MODEL_COLORS[id], fontWeight: 600, marginBottom: 4 }}>
                            {MODEL_LABELS[id] ?? 'Ensemble'}
                          </div>
                          <div style={{ display: 'flex', gap: 8, fontSize: 12, fontFamily: 'monospace' }}>
                            <span style={{ color: '#00D4AA' }}>{(m.home * 100).toFixed(0)}%</span>
                            <span style={{ color: '#7AACCC' }}>{(m.draw * 100).toFixed(0)}%</span>
                            <span style={{ color: '#F5A623' }}>{(m.away * 100).toFixed(0)}%</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

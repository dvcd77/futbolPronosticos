import { useState, useCallback } from 'react';
import { useApp, FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { TeamSelector, ProbBar, SectionTitle, ErrorBox, InfoBox, Spinner, EmptyState } from '../ui/Shared.jsx';
import ScoreMatrix from '../ui/ScoreMatrix.jsx';
import ModelWeights from '../ui/ModelWeights.jsx';
import { teamStrengthFromMatches, expectedGoals as poissonEG, poissonPrediction } from '../../models/poisson.js';
import { buildEloRatings, eloPrediction } from '../../models/elo.js';
import { formPrediction } from '../../models/form.js';
import { xgPrediction } from '../../models/xg.js';
import { mlPrediction } from '../../models/ml.js';
import { fifaRankPrediction } from '../../models/fifaRank.js';
import { ensemblePrediction, MODEL_IDS, MODEL_LABELS } from '../../models/ensemble.js';
import { runMonteCarlo } from '../../models/monteCarlo.js';
import { fetchTeamMatches, hasApiKey } from '../../api/footballApi.js';
import {
  hasApiFootballKey, findApiFootballTeamId, fetchTeamFixtures,
  normalizeApiFootballFixture, buildNameToTeamMap,
} from '../../api/apiFootball.js';
import {
  hasOddsApiKey, fetchWorldCupOdds, matchOddsToTeams,
  averageH2HOdds, averageTotalsOdds, impliedProbabilities,
} from '../../api/oddsApi.js';
import { BarChart, Bar, XAxis, YAxis, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const MODEL_COLORS = {
  poisson: '#00D4AA', elo: '#7AACCC', form: '#F5A623',
  xg: '#BC8CFF', ml: '#3FB950', fifa: '#FFD700', ensemble: '#F85149',
};

// Defined outside the component so it is never recreated on each render
function ProbTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0D172E', border: '1px solid #1C3254', borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontFamily: 'monospace', fontWeight: 700, color: payload[0].fill }}>
        {payload[0].value}%
      </div>
    </div>
  );
}

/**
 * Compares model probability vs bookmaker implied probability (vig-removed).
 * "Edge" = model_prob − market_prob. Positive edge = model thinks it's more
 * likely than the market is pricing in (potential value, per the model).
 */
function EdgeBadge({ edge }) {
  if (edge == null) return null;
  const pct = (edge * 100).toFixed(1);
  const positive = edge > 0.015;   // >1.5pp = notable edge
  const negative = edge < -0.015;
  const color = positive ? '#3FB950' : negative ? '#F85149' : '#5a7a9a';
  const sign = edge > 0 ? '+' : '';
  return (
    <span style={{
      fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color,
      background: positive ? '#0d2e1e' : negative ? '#2e0d0d' : 'transparent',
      padding: positive || negative ? '1px 5px' : 0, borderRadius: 4,
    }}>
      {sign}{pct}pp
    </span>
  );
}

function OddsComparison({ homeTeam, awayTeam, result }) {
  const [oddsState, setOddsState] = useState({ status: 'idle' }); // idle | loading | found | not_found | error

  async function loadOdds() {
    setOddsState({ status: 'loading' });
    try {
      const events = await fetchWorldCupOdds();
      const event = matchOddsToTeams(events, homeTeam, awayTeam);
      if (!event) {
        setOddsState({ status: 'not_found' });
        return;
      }
      const h2h = averageH2HOdds(event);
      const totals25 = averageTotalsOdds(event, 2.5);
      if (!h2h) {
        setOddsState({ status: 'not_found' });
        return;
      }
      const implied = impliedProbabilities(h2h);
      setOddsState({ status: 'found', h2h, totals25, implied, bookmakerCount: h2h.bookmakerCount });
    } catch (e) {
      setOddsState({ status: 'error', message: e.message });
    }
  }

  if (!hasOddsApiKey()) {
    return (
      <div className="card">
        <SectionTitle sub="Compara tus pronósticos contra el mercado real de apuestas">
          🎰 Cuotas de casas de apuestas
        </SectionTitle>
        <div style={{ fontSize: 13, color: '#5a7a9a', textAlign: 'center', padding: '12px 0' }}>
          💡 Agrega tu API key gratuita de The Odds API en ⚙️ Configuración para comparar tus pronósticos contra cuotas reales del mercado.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <SectionTitle sub="Probabilidad implícita del mercado (cuotas promedio, margen de casa removido) vs tu modelo">
        🎰 Cuotas de casas de apuestas
      </SectionTitle>

      {oddsState.status === 'idle' && (
        <button className="btn-secondary" onClick={loadOdds} style={{ width: '100%', justifyContent: 'center' }}>
          📡 Buscar cuotas para este partido
        </button>
      )}

      {oddsState.status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Spinner size={18} />
          <div style={{ fontSize: 12, color: '#5a7a9a', marginTop: 8 }}>Consultando casas de apuestas...</div>
        </div>
      )}

      {oddsState.status === 'not_found' && (
        <InfoBox message="No se encontraron cuotas para este partido. Los mercados suelen abrir pocos días antes del encuentro." />
      )}

      {oddsState.status === 'error' && (
        <ErrorBox message={oddsState.message} />
      )}

      {oddsState.status === 'found' && (
        <div>
          <div style={{ fontSize: 11, color: '#3a5070', marginBottom: 14 }}>
            Promedio de {oddsState.bookmakerCount} casa{oddsState.bookmakerCount !== 1 ? 's' : ''} de apuestas · Margen de casa: {oddsState.implied.vigPercent.toFixed(1)}%
          </div>

          {/* 1X2 comparison table */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: 8, marginBottom: 6 }}>
            <div />
            <div className="label-sm" style={{ textAlign: 'center', fontSize: 9 }}>{homeTeam?.tla ?? 'L'}</div>
            <div className="label-sm" style={{ textAlign: 'center', fontSize: 9 }}>X</div>
            <div className="label-sm" style={{ textAlign: 'center', fontSize: 9 }}>{awayTeam?.tla ?? 'V'}</div>
          </div>

          {/* Bookmaker odds row */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: 8, marginBottom: 4, alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#5a7a9a' }}>Cuota</div>
            {[oddsState.h2h.home, oddsState.h2h.draw, oddsState.h2h.away].map((odd, i) => (
              <div key={i} style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#D8E6F3' }}>
                {odd != null ? odd.toFixed(2) : '—'}
              </div>
            ))}
          </div>

          {/* Implied probability row */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: 8, marginBottom: 4, alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#5a7a9a' }}>Mercado</div>
            {[oddsState.implied.home, oddsState.implied.draw, oddsState.implied.away].map((p, i) => (
              <div key={i} style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 13, color: '#7AACCC' }}>
                {(p * 100).toFixed(1)}%
              </div>
            ))}
          </div>

          {/* Model probability row */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: 8, marginBottom: 4, alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#5a7a9a' }}>Modelo</div>
            {[result.home, result.draw, result.away].map((p, i) => (
              <div key={i} style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: MODEL_COLORS[result.model] ?? '#F85149' }}>
                {(p * 100).toFixed(1)}%
              </div>
            ))}
          </div>

          {/* Edge row */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: 8, marginBottom: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#5a7a9a' }}>Diferencia</div>
            {[
              result.home - oddsState.implied.home,
              result.draw - oddsState.implied.draw,
              result.away - oddsState.implied.away,
            ].map((edge, i) => (
              <div key={i} style={{ textAlign: 'center' }}><EdgeBadge edge={edge} /></div>
            ))}
          </div>

          {/* Totals 2.5 comparison (if available) */}
          {oddsState.totals25 && (
            <div style={{ borderTop: '1px solid #162844', paddingTop: 12 }}>
              <div className="label-sm" style={{ marginBottom: 8 }}>Total de goles · Línea 2.5</div>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: 8, marginBottom: 4 }}>
                <div />
                <div className="label-sm" style={{ textAlign: 'center', fontSize: 9, color: '#3FB950' }}>Más de</div>
                <div className="label-sm" style={{ textAlign: 'center', fontSize: 9, color: '#F5A623' }}>Menos de</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: '#5a7a9a' }}>Cuota</div>
                <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>{oddsState.totals25.over.toFixed(2)}</div>
                <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>{oddsState.totals25.under.toFixed(2)}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: '#5a7a9a' }}>Mercado</div>
                <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: '#7AACCC' }}>
                  {((1 / oddsState.totals25.over) / (1/oddsState.totals25.over + 1/oddsState.totals25.under) * 100).toFixed(1)}%
                </div>
                <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: '#7AACCC' }}>
                  {((1 / oddsState.totals25.under) / (1/oddsState.totals25.over + 1/oddsState.totals25.under) * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: 8 }}>
                <div style={{ fontSize: 11, color: '#5a7a9a' }}>Modelo</div>
                <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#3FB950' }}>
                  {result.over?.['2.5'] != null ? (result.over['2.5']*100).toFixed(1)+'%' : '—'}
                </div>
                <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#F5A623' }}>
                  {result.under?.['2.5'] != null ? (result.under['2.5']*100).toFixed(1)+'%' : '—'}
                </div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 10, color: '#3a5070', marginTop: 14, lineHeight: 1.6 }}>
            "Diferencia" verde = el modelo ve más probabilidad de la que paga el mercado.
            Esto es solo informativo — no es una recomendación de apuesta.
          </div>
        </div>
      )}
    </div>
  );
}

function useTeamData(displayTeams) {
  const { teamMatchCache, setTeamMatchCache, setEloRatings, setApiStatus } = useApp();

  const loadTeamData = useCallback(async (teamId) => {
    if (teamMatchCache[teamId]) return teamMatchCache[teamId];
    if (!hasApiKey() && !hasApiFootballKey()) return [];

    let matches = [];
    if (hasApiKey()) {
      try {
        matches = await fetchTeamMatches(teamId);
        setApiStatus(prev => ({ ...prev, ok: true }));
      } catch {
        setApiStatus(prev => ({ ...prev, ok: false }));
      }
    }

    // ── Enrich with API-Football (AFCON, Copa América, Gold Cup, clasificatorias) ──
    // football-data.org no cubre estas competencias en su tier gratuito; las
    // sumamos aquí si el usuario configuró su key de API-Football.
    if (hasApiFootballKey()) {
      const team = displayTeams.find(t => t.id === teamId);
      if (team) {
        try {
          const afTeamId = await findApiFootballTeamId(team.name);
          if (afTeamId) {
            const fixtures = await fetchTeamFixtures(afTeamId, 25);
            const nameToTeam = buildNameToTeamMap(displayTeams);
            const afMatches = fixtures
              .map(fx => normalizeApiFootballFixture(fx, nameToTeam))
              .filter(Boolean);

            // Dedupe: misma fecha (±1 día) + mismos dos equipos + mismo marcador
            // evita contar dos veces un partido que esté en AMBAS fuentes (p.ej. WC)
            const seen = new Set(matches.map(m => dedupeKey(m)));
            const newOnes = afMatches.filter(m => {
              const key = dedupeKey(m);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });

            matches = [...matches, ...newOnes].sort(
              (a, b) => new Date(a.utcDate) - new Date(b.utcDate)
            );
          }
        } catch (e) {
          console.warn('API-Football enrichment failed:', e.message);
          // No crítico — seguimos con los datos de football-data.org solamente
        }
      }
    }

    setTeamMatchCache(prev => {
      const next = { ...prev, [teamId]: matches };
      const allMatches = Object.values(next).flat();
      setEloRatings(buildEloRatings(allMatches));
      return next;
    });
    return matches;
  }, [teamMatchCache, setTeamMatchCache, setEloRatings, setApiStatus, displayTeams]);

  return { loadTeamData };
}

function dedupeKey(m) {
  const date = (m.utcDate ?? '').slice(0, 10); // solo fecha, sin hora
  const h = String(m.homeTeam?.id ?? '');
  const a = String(m.awayTeam?.id ?? '');
  const teams = [h, a].sort().join('-');
  const score = `${m.score?.fullTime?.home ?? '?'}-${m.score?.fullTime?.away ?? '?'}`;
  return `${date}_${teams}_${score}`;
}

export default function MatchPredictor() {
  const { teams, weights, setWeights, simCount, setSimCount, addToHistory, eloRatings } = useApp();
  const displayTeams = teams.length > 0 ? teams : FALLBACK_TEAMS;
  const { loadTeamData } = useTeamData(displayTeams);

  const [homeId, setHomeId]         = useState(null);
  const [awayId, setAwayId]         = useState(null);
  const [activeModel, setActiveModel] = useState('ensemble');
  const [weightsMode, setWeightsMode] = useState('auto');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [result, setResult]         = useState(null);
  const [allModelResults, setAllModelResults] = useState(null);
  const [dataQuality, setDataQuality] = useState(null);
  const [showWeights, setShowWeights] = useState(false);
  const [saved, setSaved]           = useState(false);

  const homeTeam = displayTeams.find(t => t.id === homeId);
  const awayTeam = displayTeams.find(t => t.id === awayId);

  async function runPrediction() {
    if (!homeId || !awayId)       { setError('Selecciona ambos equipos.'); return; }
    if (homeId === awayId)        { setError('Los equipos no pueden ser el mismo.'); return; }
    setError(''); setLoading(true); setResult(null); setSaved(false); setDataQuality(null);

    try {
      const [homeMatches, awayMatches] = await Promise.all([
        loadTeamData(homeId),
        loadTeamData(awayId),
      ]);

      const hasData = [
        ...homeMatches.filter(m => m.status === 'FINISHED' && m.score?.fullTime?.home != null),
        ...awayMatches.filter(m => m.status === 'FINISHED' && m.score?.fullTime?.home != null),
      ].length > 0;

      // ── Build all model predictions ────────────────────────────────────────
      const models = {};

      // ── ELO first: used as quality fallback in ALL models below ───────────
      const eloR = eloRatings.size > 0
        ? eloRatings
        : buildEloRatings([...homeMatches, ...awayMatches]);
      models.elo = eloPrediction(homeId, awayId, eloR);

      // ── Poisson: multiplicative model, uses ELO when no match history ─────
      const homeStr = teamStrengthFromMatches(homeMatches, homeId, eloR);
      const awayStr = teamStrengthFromMatches(awayMatches, awayId, eloR);
      const { lambdaHome: lH_p, lambdaAway: lA_p } = poissonEG(homeStr, awayStr);
      models.poisson = poissonPrediction(lH_p, lA_p);

      // ── Form, xG, ML: each uses ELO differently as fallback ───────────────
      // Even without match history these now give DISTINCT probabilities.
      models.form = formPrediction(homeMatches, awayMatches, homeId, awayId, eloR);
      models.xg   = xgPrediction(homeMatches, awayMatches, homeId, awayId, eloR);
      models.ml   = mlPrediction(homeMatches, awayMatches, homeId, awayId, eloR);

      // ── FIFA Ranking: independent of match-data availability. FIFA computes
      // this with ALL official matches (including AFCON, Copa América, Gold
      // Cup), so it's a valuable signal even when our match-history API
      // doesn't cover the competition where a team was actually dominant.
      if (homeTeam?.tla && awayTeam?.tla) {
        models.fifa = fifaRankPrediction(homeTeam.tla, awayTeam.tla);
      }

      // ── Data quality snapshot: lets the user verify WHY a prediction looks
      // a certain way. The free football-data.org tier doesn't cover every
      // competition (e.g. AFCON, Copa América, Gold Cup), so a team that was
      // dominant in an uncovered tournament can show 0 real matches here while
      // the model silently falls back to ELO/base estimates instead.
      setDataQuality({
        home: {
          matchCount: homeStr.matchCount ?? 0,
          fromElo:    homeStr.fromElo,
          elo:        models.elo.eloHome,
          afCount:    homeMatches.filter(m => m.source === 'api-football').length,
        },
        away: {
          matchCount: awayStr.matchCount ?? 0,
          fromElo:    awayStr.fromElo,
          elo:        models.elo.eloAway,
          afCount:    awayMatches.filter(m => m.source === 'api-football').length,
        },
      });

      // ── Ensemble (Monte Carlo on weighted-average lambdas) ─────────────────
      // All 5 models are always populated (with ELO-fallback if no match data)
      const effWeights = weightsMode === 'auto'
        ? Object.fromEntries(MODEL_IDS.map(id => [id, 1 / MODEL_IDS.length]))
        : weights;
      models.ensemble = ensemblePrediction(models, effWeights, simCount);

      // ── Display result for the active model ────────────────────────────────
      const active = models[activeModel] ?? models.ensemble;
      const mcResult = activeModel === 'ensemble'
        ? models.ensemble
        : runMonteCarlo(active.lambdaHome ?? lH_p, active.lambdaAway ?? lA_p, simCount);

      setAllModelResults(models);
      setResult({ ...mcResult, model: activeModel, useStaticFallback: !hasData });
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

  const chartData = result ? [
    { name: homeTeam?.tla ?? 'L',  prob: +(result.home * 100).toFixed(1), fill: '#00D4AA' },
    { name: 'X',                   prob: +(result.draw * 100).toFixed(1), fill: '#7AACCC' },
    { name: awayTeam?.tla ?? 'V',  prob: +(result.away * 100).toFixed(1), fill: '#F5A623' },
  ] : [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="predictor-grid">

        {/* ── Left panel: Controls ─────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Team selectors */}
          <div className="card">
            <SectionTitle>Selección de equipos</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <TeamSelector teams={displayTeams} value={homeId} onChange={v => { setHomeId(v); setResult(null); }}
                label="🏠 Local" excludeId={awayId} />
              <div style={{ textAlign: 'center', color: '#3a5070', fontSize: 18, fontWeight: 700 }}>vs</div>
              <TeamSelector teams={displayTeams} value={awayId} onChange={v => { setAwayId(v); setResult(null); }}
                label="✈️ Visitante" excludeId={homeId} />
            </div>
          </div>

          {/* Model selector */}
          <div className="card">
            <SectionTitle>Modelo de predicción</SectionTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {[...MODEL_IDS, 'ensemble'].map(id => (
                <button key={id}
                  onClick={() => { setActiveModel(id); if (allModelResults) switchModel(id); }}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', border: '1px solid',
                    background: activeModel === id ? '#112038' : 'transparent',
                    borderColor: activeModel === id ? MODEL_COLORS[id] : '#162844',
                    color: activeModel === id ? MODEL_COLORS[id] : '#5a7a9a',
                  }}>
                  {MODEL_LABELS[id] ?? 'Ensemble'}
                </button>
              ))}
            </div>

            {activeModel === 'ensemble' && (
              <div>
                <button onClick={() => setShowWeights(p => !p)} style={{
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

          {/* Simulation count — fully functional */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <SectionTitle>Simulaciones Monte Carlo</SectionTitle>
              <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#00D4AA', fontWeight: 700 }}>
                {simCount.toLocaleString()}
              </span>
            </div>
            <input type="range" min="10000" max="50000" step="5000"
              value={simCount} onChange={e => setSimCount(Number(e.target.value))} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#3a5070', marginTop: 4 }}>
              <span>10K (rápido)</span><span>50K (preciso)</span>
            </div>
          </div>

          <button className="btn-primary" onClick={runPrediction}
            disabled={loading || !homeId || !awayId}
            style={{ width: '100%', justifyContent: 'center', fontSize: 15, padding: '14px' }}>
            {loading ? <><Spinner size={16} /> Calculando...</> : '⚽ Predecir partido'}
          </button>

          <ErrorBox message={error} />
          {result?.useStaticFallback && (
            <InfoBox message="Sin historial de API: usando datos estadísticos base (Poisson + ELO por defecto). Agrega tu API key en ⚙️ para mayor precisión." />
          )}
        </div>

        {/* ── Right panel: Results ──────────────────────────────────────── */}
        <div>
          {!result ? (
            <div className="card" style={{ minHeight: 400 }}>
              <EmptyState icon="🎯" title="Selecciona dos equipos y pulsa Predecir"
                sub="Los modelos analizarán datos históricos para generar probabilidades con intervalos de confianza" />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Match header */}
              <div className="card" style={{ padding: '18px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#00D4AA' }}>{homeTeam?.name}</div>
                    <div style={{ fontSize: 11, color: '#3a5070', marginTop: 2 }}>
                      xG: {result.lambdaHome?.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ fontSize: 22, color: '#3a5070', fontWeight: 700 }}>VS</div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#F5A623' }}>{awayTeam?.name}</div>
                    <div style={{ fontSize: 11, color: '#3a5070', marginTop: 2 }}>
                      xG: {result.lambdaAway?.toFixed(2)}
                    </div>
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

              {/* Data quality panel — shows WHY a prediction looks the way it does */}
              {dataQuality && (
                <div className="card" style={{
                  padding: '14px 18px',
                  borderColor: (dataQuality.home.fromElo || dataQuality.away.fromElo) ? '#3a2a10' : '#1C3254',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div className="label-sm">🔍 Calidad de datos usados</div>
                    {(dataQuality.home.fromElo || dataQuality.away.fromElo) && (
                      <span style={{ fontSize: 10, color: '#F5A623', fontWeight: 600 }}>
                        ⚠️ Fallback a ELO detectado
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {[
                      { team: homeTeam, dq: dataQuality.home, color: '#00D4AA' },
                      { team: awayTeam, dq: dataQuality.away, color: '#F5A623' },
                    ].map(({ team, dq, color }) => (
                      <div key={team?.id} style={{ fontSize: 12 }}>
                        <span style={{ color, fontWeight: 600 }}>{team?.name}</span>
                        {dq.fromElo ? (
                          <div style={{ color: '#F5A623', marginTop: 3 }}>
                            ⚠️ 0 partidos reales encontrados · usando solo ELO ({dq.elo})
                          </div>
                        ) : (
                          <div style={{ color: '#5a7a9a', marginTop: 3 }}>
                            ✅ {dq.matchCount} partido{dq.matchCount !== 1 ? 's' : ''} reales · ELO {dq.elo}
                            {dq.afCount > 0 && (
                              <span style={{ color: '#FFD700' }}> · {dq.afCount} vía API-Football</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {(dataQuality.home.fromElo || dataQuality.away.fromElo) && (
                    <div style={{ fontSize: 11, color: '#5a7a9a', marginTop: 10, lineHeight: 1.6, borderTop: '1px solid #162844', paddingTop: 10 }}>
                      El tier gratuito de football-data.org no cubre todas las competencias (p. ej. <strong style={{ color: '#7AACCC' }}>Copa Africana de Naciones, Copa América, Gold Cup</strong>).
                      Si un equipo fue dominante en un torneo no cubierto, esa forma reciente <strong>no llega al modelo</strong> y la predicción se apoya solo en ELO histórico.
                    </div>
                  )}
                </div>
              )}


              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                {/* 1X2 */}
                <div className="card">
                  <SectionTitle>Resultado final (1X2)</SectionTitle>
                  <div style={{ height: 130, marginBottom: 12 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barSize={44}>
                        <XAxis dataKey="name" tick={{ fill: '#5a7a9a', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: '#3a5070', fontSize: 10 }} axisLine={false} tickLine={false} width={26} />
                        <Tooltip content={<ProbTooltip />} />
                        <Bar dataKey="prob" radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                    {[
                      { label: homeTeam?.tla ?? 'L', val: result.home, std: result.stdDev?.home, color: '#00D4AA' },
                      { label: 'X',                  val: result.draw, std: result.stdDev?.draw, color: '#7AACCC' },
                      { label: awayTeam?.tla ?? 'V', val: result.away, std: result.stdDev?.away, color: '#F5A623' },
                    ].map(({ label, val, std, color }) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#5a7a9a', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color }}>
                          {(val * 100).toFixed(1)}%
                        </div>
                        {std != null && <div className="std-badge">±{(std * 100).toFixed(1)}%</div>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Over/Under + BTTS + HT */}
                <div className="card">
                  <SectionTitle>Totales de goles</SectionTitle>

                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', gap: 6, marginBottom: 10 }}>
                    <div />
                    <div className="label-sm" style={{ textAlign: 'center', color: '#3FB950' }}>
                      MÁS DE (Over)
                    </div>
                    <div className="label-sm" style={{ textAlign: 'center', color: '#F5A623' }}>
                      MENOS DE (Under)
                    </div>
                  </div>

                  {/* Over / Under rows */}
                  {['1.5', '2.5', '3.5'].map(t => {
                    const over  = result.over?.[t];
                    const under = result.under?.[t];
                    const std   = result.overStd?.[t]; // under std = same (under = 1-over)
                    if (over == null) return null;
                    return (
                      <div key={t} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', gap: 6, marginBottom: 12 }}>
                        {/* Line label */}
                        <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#5a7a9a', paddingTop: 4, fontWeight: 600 }}>
                          {t}
                        </div>
                        {/* Over bar */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, alignItems: 'center' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#3FB950', fontSize: 13 }}>
                              {(over * 100).toFixed(1)}%
                            </span>
                            {std != null && <span className="std-badge">±{(std * 100).toFixed(1)}%</span>}
                          </div>
                          <div style={{ background: '#162844', borderRadius: 4, height: 7, overflow: 'hidden' }}>
                            <div style={{ width: `${over * 100}%`, height: '100%', borderRadius: 4, background: '#3FB950', transition: 'width .7s' }} />
                          </div>
                        </div>
                        {/* Under bar */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, alignItems: 'center' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#F5A623', fontSize: 13 }}>
                              {(under * 100).toFixed(1)}%
                            </span>
                            {std != null && <span className="std-badge">±{(std * 100).toFixed(1)}%</span>}
                          </div>
                          <div style={{ background: '#162844', borderRadius: 4, height: 7, overflow: 'hidden' }}>
                            <div style={{ width: `${under * 100}%`, height: '100%', borderRadius: 4, background: '#F5A623', transition: 'width .7s' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* BTTS */}
                  <div style={{ borderTop: '1px solid #162844', marginTop: 4, paddingTop: 12 }}>
                    <ProbBar label="Ambos anotan (BTTS)" value={result.btts} std={result.bttsStd} color="#BC8CFF" height={6} />
                  </div>

                  {/* Half-time */}
                  <div style={{ borderTop: '1px solid #162844', marginTop: 8, paddingTop: 12 }}>
                    <div className="label-sm" style={{ marginBottom: 8 }}>Medio tiempo</div>
                    {[
                      { label: homeTeam?.tla ?? 'L', val: result.halfTime?.home, std: result.halfTimeStd?.home, color: '#00D4AA' },
                      { label: 'Empate HT',          val: result.halfTime?.draw, std: result.halfTimeStd?.draw, color: '#7AACCC' },
                      { label: awayTeam?.tla ?? 'V', val: result.halfTime?.away, std: result.halfTimeStd?.away, color: '#F5A623' },
                    ].map(({ label, val, std, color }) => val != null && (
                      <ProbBar key={label} label={label} value={val} std={std} color={color} height={5} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Score matrix */}
              <div className="card">
                <SectionTitle sub="Probabilidad de cada marcador exacto (filas = local, columnas = visitante)">
                  Matriz de marcadores
                </SectionTitle>
                <ScoreMatrix scores={result.scores}
                  homeLabel={homeTeam?.tla ?? 'Local'}
                  awayLabel={awayTeam?.tla ?? 'Visitante'} />
              </div>

              {/* Per-team Over/Under */}
              {result.teamGoals && (
                <div className="card">
                  <SectionTitle sub="Goles individuales de cada equipo (independiente del marcador del rival)">
                    Over/Under goles por equipo
                  </SectionTitle>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    {[
                      { team: homeTeam, side: 'home', color: '#00D4AA' },
                      { team: awayTeam, side: 'away', color: '#F5A623' },
                    ].map(({ team, side, color }) => {
                      const tg = result.teamGoals[side];
                      return (
                        <div key={side}>
                          <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 10 }}>
                            {team?.name ?? (side === 'home' ? 'Local' : 'Visitante')}
                          </div>

                          {/* Column headers */}
                          <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr', gap: 6, marginBottom: 8 }}>
                            <div />
                            <div className="label-sm" style={{ textAlign: 'center', fontSize: 9 }}>Más de</div>
                            <div className="label-sm" style={{ textAlign: 'center', fontSize: 9 }}>Menos de</div>
                          </div>

                          {['0.5', '1.5', '2.5'].map(line => {
                            const over  = tg.over?.[line];
                            const under = tg.under?.[line];
                            const std   = tg.overStd?.[line];
                            if (over == null) return null;
                            return (
                              <div key={line} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr', gap: 6, marginBottom: 10 }}>
                                <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#5a7a9a', paddingTop: 4, fontWeight: 600 }}>
                                  {line}
                                </div>
                                {/* Over */}
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color }}>
                                      {(over * 100).toFixed(1)}%
                                    </span>
                                    {std != null && <span className="std-badge" style={{ fontSize: 9 }}>±{(std * 100).toFixed(1)}%</span>}
                                  </div>
                                  <div style={{ background: '#162844', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                                    <div style={{ width: `${over * 100}%`, height: '100%', borderRadius: 4, background: color, transition: 'width .7s' }} />
                                  </div>
                                </div>
                                {/* Under */}
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: '#5a7a9a' }}>
                                      {(under * 100).toFixed(1)}%
                                    </span>
                                    {std != null && <span className="std-badge" style={{ fontSize: 9 }}>±{(std * 100).toFixed(1)}%</span>}
                                  </div>
                                  <div style={{ background: '#162844', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                                    <div style={{ width: `${under * 100}%`, height: '100%', borderRadius: 4, background: '#5a7a9a', transition: 'width .7s' }} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ fontSize: 11, color: '#3a5070', marginTop: 4, borderTop: '1px solid #162844', paddingTop: 10 }}>
                    Ej: "{homeTeam?.tla ?? 'Local'} Más de 1.5" = probabilidad de que {homeTeam?.name ?? 'el local'} anote 2 o más goles, sin importar el resultado del rival.
                  </div>
                </div>
              )}

              {/* Bookmaker odds comparison */}
              <OddsComparison homeTeam={homeTeam} awayTeam={awayTeam} result={result} />

              {/* Quick model switcher */}
              {allModelResults && (
                <div className="card">
                  <SectionTitle sub="Clic para ver el pronóstico de cada modelo">
                    Comparar modelos rápido
                  </SectionTitle>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {[...MODEL_IDS, 'ensemble'].map(id => {
                      const m = allModelResults[id];
                      if (!m) return null;
                      const isActive = result.model === id;
                      return (
                        <button key={id} onClick={() => switchModel(id)} style={{
                          padding: '8px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                          minWidth: 105, border: `1px solid ${isActive ? MODEL_COLORS[id] : '#1C3254'}`,
                          background: isActive ? '#112038' : '#0A1225',
                        }}>
                          <div style={{ fontSize: 11, color: MODEL_COLORS[id], fontWeight: 600, marginBottom: 4 }}>
                            {MODEL_LABELS[id] ?? 'Ensemble'}
                          </div>
                          <div style={{ display: 'flex', gap: 6, fontSize: 12, fontFamily: 'monospace' }}>
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

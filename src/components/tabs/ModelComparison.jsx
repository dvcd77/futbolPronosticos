import { useState } from 'react';
import { useApp, FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { TeamSelector, SectionTitle, ErrorBox, Spinner, EmptyState } from '../ui/Shared.jsx';
import { teamStrengthFromMatches, expectedGoals, poissonPrediction } from '../../models/poisson.js';
import { buildEloRatings, eloPrediction } from '../../models/elo.js';
import { formPrediction } from '../../models/form.js';
import { xgPrediction } from '../../models/xg.js';
import { fifaRankPrediction } from '../../models/fifaRank.js';
import { headToHeadPrediction } from '../../models/headToHead.js';
import { confederationShrinkagePrediction } from '../../models/confederationShrinkage.js';
import { marketPrediction } from '../../models/market.js';
import { hasOddsApiKey, fetchWorldCupOdds, matchOddsToTeams, averageH2HOdds, impliedProbabilities } from '../../api/oddsApi.js';
import { ensemblePrediction, MODEL_IDS, MODEL_LABELS, DEFAULT_WEIGHTS } from '../../models/ensemble.js';
import { fetchTeamMatches, hasApiKey } from '../../api/footballApi.js';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';

const MODEL_COLORS = {
  poisson:'#00D4AA', elo:'#7AACCC', form:'#F5A623', xg:'#BC8CFF',
  fifa:'#FFD700', confShrink:'#FF8FB1', h2h:'#5FD3F3', market:'#3FB950',
  ensemble:'#F85149',
};

function PctCell({ value, color }) {
  if (value == null) return <td style={{ padding: '8px 12px', color: '#3a5070', textAlign: 'center' }}>—</td>;
  return (
    <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, color }}>
      {(value * 100).toFixed(1)}%
    </td>
  );
}

function LambdaCell({ value }) {
  if (value == null) return <td style={{ padding: '8px 12px', color: '#3a5070', textAlign: 'center' }}>—</td>;
  return (
    <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: '#7AACCC' }}>
      {value.toFixed(2)}
    </td>
  );
}

export default function ModelComparison() {
  const { teams, eloRatings, setEloRatings, teamMatchCache, setTeamMatchCache, simCount, setApiStatus } = useApp();
  const displayTeams = teams.length > 0 ? teams : FALLBACK_TEAMS;

  const [homeId, setHomeId] = useState(null);
  const [awayId, setAwayId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  const homeTeam = displayTeams.find(t => t.id === homeId);
  const awayTeam = displayTeams.find(t => t.id === awayId);

  async function loadMatches(teamId) {
    if (teamMatchCache[teamId]) return teamMatchCache[teamId];
    if (!hasApiKey()) return [];
    const m = await fetchTeamMatches(teamId);
    setTeamMatchCache(prev => ({ ...prev, [teamId]: m }));
    return m;
  }

  async function runComparison() {
    if (!homeId || !awayId || homeId === awayId) { setError('Selecciona dos equipos distintos.'); return; }
    setError(''); setLoading(true); setResults(null);

    try {
      const [hm, am, oddsEvents] = await Promise.all([
        loadMatches(homeId),
        loadMatches(awayId),
        hasOddsApiKey() ? fetchWorldCupOdds().catch(() => []) : Promise.resolve([]),
      ]);
      setApiStatus(prev => ({ ...prev, ok: hasApiKey() }));

      // ELO computed first so all models can use it as a fallback signal
      const eloR = eloRatings.size > 0 ? eloRatings : buildEloRatings([...hm, ...am]);
      if (eloRatings.size === 0) setEloRatings(eloR);

      const homeStr = teamStrengthFromMatches(hm, homeId, eloR);
      const awayStr = teamStrengthFromMatches(am, awayId, eloR);
      const { lambdaHome: lH, lambdaAway: lA } = expectedGoals(homeStr, awayStr);

      const models = {
        poisson: poissonPrediction(lH, lA),
        elo: eloPrediction(homeId, awayId, eloR),
        form: formPrediction(hm, am, homeId, awayId, eloR),
        xg: xgPrediction(hm, am, homeId, awayId, eloR),
      };
      if (homeTeam?.tla && awayTeam?.tla) {
        models.fifa = fifaRankPrediction(homeTeam.tla, awayTeam.tla);
      }
      models.confShrink = confederationShrinkagePrediction(
        homeTeam, awayTeam, homeStr.matchCount ?? 0, awayStr.matchCount ?? 0, eloR, displayTeams
      );
      models.h2h = headToHeadPrediction([...hm, ...am], homeId, awayId);

      if (oddsEvents.length > 0) {
        const event = matchOddsToTeams(oddsEvents, homeTeam, awayTeam);
        if (event) {
          const h2hOdds = averageH2HOdds(event);
          if (h2hOdds) {
            const implied = impliedProbabilities(h2hOdds);
            models.market = marketPrediction(implied, { bookmakerCount: h2hOdds.bookmakerCount, vigPercent: implied.vigPercent });
          }
        }
      }

      models.ensemble = ensemblePrediction(models, DEFAULT_WEIGHTS, simCount);

      setResults(models);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Build radar chart data — clamp all values to [0,100], no \n in labels
  const radarData = results ? [
    { metric: `${homeTeam?.tla ?? 'Local'} gana` },
    { metric: 'xG Local' },
    { metric: 'Over 2.5' },
    { metric: 'BTTS' },
    { metric: `${awayTeam?.tla ?? 'Visit.'} gana` },
    { metric: 'xG Visit.' },
  ].map((d, i) => {
    const entry = { metric: d.metric };
    Object.entries(results).forEach(([id, m]) => {
      const rawVals = [
        m.home,
        m.lambdaHome / 4,          // scale: 0–4.5 goals → 0–112%; clamp below
        m.over?.['2.5'] ?? 0.5,
        m.btts ?? 0.5,
        m.away,
        m.lambdaAway / 4,
      ];
      entry[id] = Math.min(100, Math.max(0, Math.round((rawVals[i] ?? 0.5) * 100)));
    });
    return entry;
  }) : [];

  const allModels = results ? [...MODEL_IDS, 'ensemble'] : [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <SectionTitle>Comparación de todos los modelos</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 12, alignItems: 'end' }}>
          <TeamSelector teams={displayTeams} value={homeId} onChange={setHomeId} label="Local" excludeId={awayId} disabled={loading} />
          <span style={{ color: '#3a5070', fontSize: 20, paddingBottom: 8 }}>vs</span>
          <TeamSelector teams={displayTeams} value={awayId} onChange={setAwayId} label="Visitante" excludeId={homeId} disabled={loading} />
          <button className="btn-primary" onClick={runComparison} disabled={loading || !homeId || !awayId}
            style={{ paddingBottom: 10, paddingTop: 10 }}>
            {loading ? <Spinner size={16} /> : '📊 Comparar'}
          </button>
        </div>
        <ErrorBox message={error} />
      </div>

      {!results ? (
        <EmptyState icon="📊" title="Compara todos los modelos en una vista"
          sub="Ver cómo cada modelo (Poisson, ELO, Forma, xG, ML, Ensemble) pronostica el mismo partido" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Table */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <SectionTitle>{homeTeam?.name} vs {awayTeam?.name}</SectionTitle>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #162844' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a9a', fontWeight: 600 }}>Modelo</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#00D4AA', fontWeight: 600 }}>
                    {homeTeam?.shortName ?? 'L'} (1)
                  </th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#7AACCC', fontWeight: 600 }}>X</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#F5A623', fontWeight: 600 }}>
                    {awayTeam?.shortName ?? 'V'} (2)
                  </th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#5a7a9a', fontWeight: 600 }}>xG L</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#5a7a9a', fontWeight: 600 }}>xG V</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#3FB950', fontWeight: 600 }}>O+2.5</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#BC8CFF', fontWeight: 600 }}>BTTS</th>
                </tr>
              </thead>
              <tbody>
                {allModels.map((id, i) => {
                  const m = results[id];
                  if (!m) return null;
                  const isEnsemble = id === 'ensemble';
                  return (
                    <tr key={id} style={{
                      borderBottom: i < allModels.length - 1 ? '1px solid #0A1225' : 'none',
                      background: isEnsemble ? '#0d1a2e' : 'transparent',
                    }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: MODEL_COLORS[id] }} />
                          <span style={{ color: isEnsemble ? MODEL_COLORS[id] : '#D8E6F3', fontWeight: isEnsemble ? 700 : 400 }}>
                            {MODEL_LABELS[id] ?? 'Ensemble'}
                          </span>
                        </div>
                      </td>
                      <PctCell value={m.home} color="#00D4AA" />
                      <PctCell value={m.draw} color="#7AACCC" />
                      <PctCell value={m.away} color="#F5A623" />
                      <LambdaCell value={m.lambdaHome} />
                      <LambdaCell value={m.lambdaAway} />
                      <PctCell value={m.over?.['2.5']} color="#3FB950" />
                      <PctCell value={m.btts} color="#BC8CFF" />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Radar chart */}
          <div className="card">
            <SectionTitle sub="Comparación visual de métricas entre modelos">Radar de modelos</SectionTitle>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#162844" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#5a7a9a', fontSize: 10 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: '#3a5070', fontSize: 9 }} />
                  {allModels.map(id => (
                    <Radar key={id} dataKey={id} name={MODEL_LABELS[id] ?? 'Ensemble'}
                      stroke={MODEL_COLORS[id]} fill={MODEL_COLORS[id]} fillOpacity={0.08} strokeWidth={2} />
                  ))}
                  <Tooltip
                    formatter={(v, name) => [`${v}%`, MODEL_LABELS[name] ?? name]}
                    contentStyle={{ background: '#0D172E', border: '1px solid #1C3254', borderRadius: 6, fontSize: 12 }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Mini prob bars per model */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {allModels.map(id => {
              const m = results[id];
              if (!m) return null;
              const maxVal = Math.max(m.home, m.draw, m.away);
              return (
                <div key={id} className="card-sm">
                  <div style={{ fontSize: 12, fontWeight: 600, color: MODEL_COLORS[id], marginBottom: 10 }}>
                    {MODEL_LABELS[id] ?? 'Ensemble'}
                  </div>
                  {[
                    { label: homeTeam?.shortName ?? 'L', val: m.home, color: '#00D4AA' },
                    { label: 'X', val: m.draw, color: '#7AACCC' },
                    { label: awayTeam?.shortName ?? 'V', val: m.away, color: '#F5A623' },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: '#5a7a9a' }}>{label}</span>
                        <span style={{ fontFamily: 'monospace', color, fontWeight: val === maxVal ? 700 : 400 }}>
                          {(val * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ background: '#162844', borderRadius: 3, height: 4 }}>
                        <div style={{ width: `${val * 100}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.6s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

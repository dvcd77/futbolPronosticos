import { useState } from 'react';
import { useApp, FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { TeamSelector, SectionTitle, ErrorBox, Spinner, EmptyState, StatCard } from '../ui/Shared.jsx';
import { teamShotsPrediction, playerShotsPrediction } from '../../models/shots.js';
import { teamStrengthFromMatches, expectedGoals } from '../../models/poisson.js';
import { fetchTeamMatches, fetchScorers, hasApiKey } from '../../api/footballApi.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// Map football-data.org section names → internal position codes used in shots.js
const SECTION_TO_POS = {
  'Goalkeeper': 'GK',
  'Defence':    'DF',
  'Defender':   'DF',
  'Midfield':   'MF',
  'Midfielder': 'MF',
  'Offence':    'FW',
  'Forward':    'FW',
  'Attacker':   'FW',
};

function ShotsBar({ label, mean, std, max, color }) {
  const pct = max > 0 ? Math.min((mean / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#7AACCC' }}>{label}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color, fontSize: 15 }}>
          {mean} <span style={{ fontSize: 11, color: '#3a5070', fontWeight: 400 }}>± {std}</span>
        </span>
      </div>
      <div style={{ background: '#162844', borderRadius: 4, height: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color, transition: 'width 0.7s' }} />
      </div>
    </div>
  );
}

export default function ShotsPredictor() {
  // Single useApp() call (was called twice — bug fixed)
  const { teamMatchCache, setTeamMatchCache, setApiStatus, teams } = useApp();
  const displayTeams = teams.length > 0 ? teams : FALLBACK_TEAMS;

  const [homeId, setHomeId]           = useState(null);
  const [awayId, setAwayId]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState(null);
  const [scorers, setScorers]         = useState([]);
  const [selectedScorerId, setSelectedScorerId] = useState(null);
  const [playerResult, setPlayerResult] = useState(null);

  async function loadAndGetMatches(teamId) {
    if (teamMatchCache[teamId]) return teamMatchCache[teamId];
    if (!hasApiKey()) return [];
    const matches = await fetchTeamMatches(teamId);
    setTeamMatchCache(prev => ({ ...prev, [teamId]: matches }));
    return matches;
  }

  async function runShots() {
    if (!homeId || !awayId) { setError('Selecciona ambos equipos.'); return; }
    if (homeId === awayId)  { setError('Los equipos no pueden ser el mismo.'); return; }
    setError(''); setLoading(true); setResult(null); setPlayerResult(null);
    setScorers([]); setSelectedScorerId(null);

    try {
      const [homeMatches, awayMatches] = await Promise.all([
        loadAndGetMatches(homeId),
        loadAndGetMatches(awayId),
      ]);
      setApiStatus(prev => ({ ...prev, ok: hasApiKey() }));

      const homeStr = teamStrengthFromMatches(homeMatches, homeId);
      const awayStr = teamStrengthFromMatches(awayMatches, awayId);
      const { lambdaHome, lambdaAway } = expectedGoals(homeStr, awayStr);

      const shotsRes = teamShotsPrediction(lambdaHome, lambdaAway, 10000);
      setResult({ ...shotsRes, lambdaHome, lambdaAway });

      // Fetch scorers for player-level shots (requires API key)
      if (hasApiKey()) {
        try {
          const scorersList = await fetchScorers('WC', 50);
          const relevant = scorersList.filter(
            s => s.team?.id === homeId || s.team?.id === awayId
          );
          setScorers(relevant.slice(0, 20));
        } catch { /* scorers not critical — silent fail */ }
      }
    } catch (e) {
      setError(e.message ?? 'Error al calcular disparos.');
    } finally {
      setLoading(false);
    }
  }

  function handlePlayerSelect(scorerId) {
    const id = scorerId ? Number(scorerId) : null;
    setSelectedScorerId(id);
    if (!id || !result) { setPlayerResult(null); return; }

    const scorer = scorers.find(s => s.player?.id === id);
    if (!scorer) return;

    const teamId      = scorer.team?.id;
    const teamLambda  = teamId === homeId ? result.lambdaHome : result.lambdaAway;

    // Estimate team's historical goal rate for share calculation
    const teamMatches = teamMatchCache[teamId] ?? [];
    const validM = teamMatches.filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED');
    let teamGoalRate = teamLambda; // fallback = expected goals
    if (validM.length > 0) {
      const total = validM.reduce((s, m) => {
        const isH = m.homeTeam?.id === teamId;
        return s + (isH ? m.score.fullTime.home : m.score.fullTime.away);
      }, 0);
      teamGoalRate = total / validM.length;
    }

    // Map API section → position code (bug fix: was using raw section string)
    const rawSection = scorer.player?.section ?? 'Midfield';
    const position   = SECTION_TO_POS[rawSection] ?? 'MF';

    const pr = playerShotsPrediction({
      id:             scorer.player?.id,
      name:           scorer.player?.name ?? 'Jugador',
      goals:          scorer.goals ?? 1,
      matchesPlayed:  scorer.playedMatches ?? 5,
      position,
    }, teamLambda, teamGoalRate, 10000);

    setPlayerResult(pr);
  }

  const homeTeam = displayTeams.find(t => t.id === homeId);
  const awayTeam = displayTeams.find(t => t.id === awayId);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <SectionTitle>Predicción de disparos por partido</SectionTitle>
        <div className="controls-grid">
          <TeamSelector teams={displayTeams} value={homeId} onChange={setHomeId} label="Local" excludeId={awayId} />
          <span className="vs-label" style={{ color: '#3a5070', fontSize: 20, paddingBottom: 8 }}>vs</span>
          <TeamSelector teams={displayTeams} value={awayId} onChange={setAwayId} label="Visitante" excludeId={homeId} />
          <button className="btn-primary" onClick={runShots} disabled={loading || !homeId || !awayId}
            style={{ paddingTop: 10, paddingBottom: 10 }}>
            {loading ? <Spinner size={16} /> : '⚡ Calcular'}
          </button>
        </div>
        <ErrorBox message={error} />
      </div>

      {!result ? (
        <EmptyState icon="⚽" title="Selecciona un partido y pulsa Calcular"
          sub="Estimación basada en fuerza atacante/defensiva. Disparos aproximados mediante modelos estadísticos (sin datos de tiros reales en el tier gratuito)." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Team shot cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { team: homeTeam, side: 'home', lambda: result.lambdaHome, color: '#00D4AA' },
              { team: awayTeam, side: 'away', lambda: result.lambdaAway, color: '#F5A623' },
            ].map(({ team, side, lambda, color }) => {
              const d = result[side];
              return (
                <div key={side} className="card">
                  <div style={{ color, fontWeight: 700, marginBottom: 14, fontSize: 15 }}>
                    {team?.name ?? (side === 'home' ? 'Local' : 'Visitante')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <StatCard label="Disparos totales"   value={d.shots.mean}         sub={`± ${d.shots.std}`}         color={color} />
                    <StatCard label="A puerta"           value={d.shotsOnTarget.mean} sub={`± ${d.shotsOnTarget.std}`} color={color} />
                  </div>
                  <ShotsBar label="Disparos totales"   mean={d.shots.mean}         std={d.shots.std}         max={25} color={color} />
                  <ShotsBar label="Disparos a puerta"  mean={d.shotsOnTarget.mean} std={d.shotsOnTarget.std} max={12} color={color} />
                  <div style={{ fontSize: 11, color: '#3a5070', marginTop: 6 }}>
                    xG estimado: <span style={{ color, fontFamily: 'monospace' }}>{lambda?.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Shot distribution histogram */}
          <div className="card">
            <SectionTitle sub="Distribución de disparos totales (local) por simulación">
              Histograma de disparos
            </SectionTitle>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.histograms?.homeShots?.filter(d => d.value <= 25) ?? []} barSize={12}>
                  <XAxis dataKey="value" tick={{ fill: '#3a5070', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    formatter={v => [`${(v * 100).toFixed(1)}%`, 'Prob']}
                    contentStyle={{ background: '#0D172E', border: '1px solid #1C3254', borderRadius: 6 }}
                  />
                  <Bar dataKey="prob" radius={[2, 2, 0, 0]}>
                    {(result.histograms?.homeShots ?? []).map((_, i) => (
                      <Cell key={i} fill="#00D4AA" opacity={0.75} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 11, color: '#3a5070', textAlign: 'center', marginTop: 4 }}>
              ⚠️ Datos de disparos reales no disponibles en el tier gratuito · Estimación estadística
            </div>
          </div>

          {/* Player shots */}
          {scorers.length > 0 && (
            <div className="card">
              <SectionTitle sub="Estimación de disparos esperados para un jugador individual">
                Predicción de jugador
              </SectionTitle>
              <div style={{ marginBottom: 14 }}>
                <div className="label-sm" style={{ marginBottom: 6 }}>Seleccionar jugador</div>
                <div style={{ position: 'relative' }}>
                  <select value={selectedScorerId ?? ''} onChange={e => handlePlayerSelect(e.target.value || null)}>
                    <option value="">— Elegir jugador —</option>
                    {scorers.map(s => (
                      <option key={s.player?.id} value={s.player?.id}>
                        {s.player?.name} ({s.team?.shortName ?? s.team?.name}) — {s.goals} goles · {s.player?.section ?? 'N/A'}
                      </option>
                    ))}
                  </select>
                  <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#5a7a9a' }}>▼</div>
                </div>
              </div>

              {playerResult && (
                <div>
                  <div style={{ fontSize: 12, color: '#5a7a9a', marginBottom: 10 }}>
                    {playerResult.playerName} · Posición: <strong style={{ color: '#7AACCC' }}>{playerResult.position}</strong> · 
                    Participación: <strong style={{ color: '#00D4AA' }}>{playerResult.goalShare}%</strong> del ataque
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                    <StatCard label="Disparos esp."  value={playerResult.shots.mean}         sub={`± ${playerResult.shots.std}`}         color="#BC8CFF" />
                    <StatCard label="A puerta esp."  value={playerResult.shotsOnTarget.mean} sub={`± ${playerResult.shotsOnTarget.std}`} color="#BC8CFF" />
                    <StatCard label="xG jugador"     value={playerResult.playerLambda}       sub="goles esperados"                       color="#3FB950" />
                    <StatCard label="% del ataque"   value={`${playerResult.goalShare}%`}    sub="participación"                         color="#F5A623" />
                  </div>
                </div>
              )}
            </div>
          )}

          {!hasApiKey() && (
            <div style={{ fontSize: 12, color: '#3a5070', textAlign: 'center', padding: 12 }}>
              💡 Agrega tu API key en ⚙️ Configuración para obtener goleadores reales del partido
            </div>
          )}
        </div>
      )}
    </div>
  );
}

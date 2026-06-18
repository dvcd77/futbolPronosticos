import { useState } from 'react';
import { useApp, FALLBACK_TEAMS } from '../../context/AppContext.jsx';
import { TeamSelector, SectionTitle, ErrorBox, Spinner, EmptyState, StatCard } from '../ui/Shared.jsx';
import { teamShotsPrediction, playerShotsPrediction } from '../../models/shots.js';
import { teamStrengthFromMatches, expectedGoals } from '../../models/poisson.js';
import { fetchTeamMatches, fetchTeamSquad, fetchScorers, hasApiKey } from '../../api/footballApi.js';

// API section → internal position code
const SECTION_TO_POS = {
  Goalkeeper: 'GK', Defence: 'DF', Defender: 'DF',
  Midfield: 'MF',  Midfielder: 'MF',
  Offence: 'FW',   Forward: 'FW', Attacker: 'FW',
};

// Default goal share per position (fraction of team goals, used when no scorer data)
const POS_DEFAULT_SHARE = { GK: 0.003, DF: 0.028, MF: 0.065, FW: 0.210 };

// Priority for "most likely starters" ordering (1=most likely)
const POS_PRIORITY = { FW: 1, MF: 2, DF: 3, GK: 4 };

// Position display labels (Spanish)
const POS_LABEL = { GK: 'POR', DF: 'DEF', MF: 'CEN', FW: 'DEL' };

/**
 * Build a combined player list from squad + scorer data.
 * Returns players enriched with position, goal share and pre-computed shots.
 */
function buildPlayerList({ squad, scorers, teamId, teamLambda, teamGoalRate, simCount = 5000 }) {
  if (!squad.length) return [];

  // Build scorer lookup by player ID
  const scorerMap = {};
  scorers.filter(s => s.team?.id === teamId).forEach(s => {
    if (s.player?.id) {
      scorerMap[s.player.id] = { goals: s.goals ?? 0, played: s.playedMatches ?? 3 };
    }
  });

  const effectiveGoalRate = Math.max(teamGoalRate, 0.5);

  const players = squad
    .map(player => {
      const pos    = SECTION_TO_POS[player.position] ?? 'MF';
      const scorer = scorerMap[player.id];
      const goals  = scorer?.goals ?? 0;
      const played = scorer?.played ?? 3;

      // Goal share: use actual goal rate if scorer, else position default
      const goalShare = goals > 0
        ? Math.min(goals / (played * effectiveGoalRate), 0.65)
        : POS_DEFAULT_SHARE[pos] ?? 0.065;

      const shots = playerShotsPrediction({
        id:            player.id,
        name:          player.name ?? 'Jugador',
        goals,
        matchesPlayed: played,
        position:      pos,
      }, teamLambda, effectiveGoalRate, simCount);

      return {
        id:           player.id,
        name:         player.name,
        pos,
        goals,
        played,
        goalShare:    Math.round(goalShare * 100),
        hasRealGoals: goals > 0,
        shots:        shots.shots,
        sot:          shots.shotsOnTarget,
        xg:           shots.playerLambda,
      };
    })
    .sort((a, b) => {
      // Sort: forwards first, then by goal share within position
      const priDiff = (POS_PRIORITY[a.pos] ?? 5) - (POS_PRIORITY[b.pos] ?? 5);
      return priDiff !== 0 ? priDiff : b.goalShare - a.goalShare;
    });

  return players;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ShotsBar({ label, mean, std, max, color }) {
  const pct = max > 0 ? Math.min((mean / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: '#7AACCC' }}>{label}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color, fontSize: 14 }}>
          {mean} <span style={{ fontSize: 11, color: '#3a5070', fontWeight: 400 }}>± {std}</span>
        </span>
      </div>
      <div style={{ background: '#162844', borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color, transition: 'width .7s' }} />
      </div>
    </div>
  );
}

function PlayerTable({ players, color, title, showAll, onToggleAll }) {
  const visible = showAll ? players : players.slice(0, 5);
  if (!visible.length) return null;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color }}>{title}</div>
        <div style={{ fontSize: 11, color: '#3a5070' }}>
          {players.length} jugadores en la plantilla
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #162844' }}>
              <th style={{ textAlign: 'left',   padding: '6px 8px', color: '#5a7a9a', fontWeight: 600 }}>Jugador</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', color: '#5a7a9a', fontWeight: 600 }}>Pos</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', color: '#5a7a9a', fontWeight: 600 }}>Disparos</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', color: '#5a7a9a', fontWeight: 600 }}>A puerta</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', color: '#5a7a9a', fontWeight: 600 }}>xG</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', color: '#5a7a9a', fontWeight: 600 }}>% ataque</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <tr key={p.id} style={{
                borderBottom: '1px solid #0A1225',
                background: i % 2 === 0 ? 'transparent' : '#0A1225',
              }}>
                <td style={{ padding: '7px 8px', color: '#D8E6F3', fontWeight: p.hasRealGoals ? 600 : 400 }}>
                  {p.name}
                  {p.hasRealGoals && (
                    <span style={{ fontSize: 10, color: '#3FB950', marginLeft: 5 }}>
                      ⚽{p.goals}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'center', padding: '7px 8px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                    fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                    background: p.pos === 'FW' ? '#003d20' : p.pos === 'MF' ? '#1a2e00' : p.pos === 'DF' ? '#001a3a' : '#1a1a1a',
                    color: p.pos === 'FW' ? '#3FB950' : p.pos === 'MF' ? '#9FD050' : p.pos === 'DF' ? '#7AACCC' : '#5a7a9a',
                  }}>
                    {POS_LABEL[p.pos]}
                  </span>
                </td>
                <td style={{ textAlign: 'center', padding: '7px 8px', fontFamily: 'monospace', fontWeight: 700, color }}>
                  {p.shots.mean}
                  <span style={{ fontSize: 10, color: '#3a5070', fontWeight: 400 }}> ±{p.shots.std}</span>
                </td>
                <td style={{ textAlign: 'center', padding: '7px 8px', fontFamily: 'monospace', color }}>
                  {p.sot.mean}
                  <span style={{ fontSize: 10, color: '#3a5070' }}> ±{p.sot.std}</span>
                </td>
                <td style={{ textAlign: 'center', padding: '7px 8px', fontFamily: 'monospace', color: '#7AACCC' }}>
                  {p.xg}
                </td>
                <td style={{ textAlign: 'center', padding: '7px 8px', color: '#5a7a9a' }}>
                  {p.goalShare}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {players.length > 5 && (
        <button onClick={onToggleAll} style={{
          marginTop: 8, background: 'transparent', border: '1px solid #162844',
          borderRadius: 6, padding: '5px 14px', fontSize: 11, color: '#5a7a9a',
          cursor: 'pointer', width: '100%',
        }}>
          {showAll ? `▲ Mostrar solo los 5 primeros` : `▼ Ver los ${players.length} jugadores de la plantilla`}
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ShotsPredictor() {
  const { teamMatchCache, setTeamMatchCache, setApiStatus, eloRatings, teams } = useApp();
  const displayTeams = teams.length > 0 ? teams : FALLBACK_TEAMS;

  const [homeId, setHomeId]           = useState(null);
  const [awayId, setAwayId]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [loadingMsg, setLoadingMsg]   = useState('');
  const [error, setError]             = useState('');
  const [result, setResult]           = useState(null);
  const [showAllHome, setShowAllHome] = useState(false);
  const [showAllAway, setShowAllAway] = useState(false);

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
    setError(''); setLoading(true); setResult(null);
    setShowAllHome(false); setShowAllAway(false);

    try {
      // ── Step 1: Load team match histories ─────────────────────────────────
      setLoadingMsg('Cargando historial de partidos...');
      const [homeMatches, awayMatches] = await Promise.all([
        loadAndGetMatches(homeId),
        loadAndGetMatches(awayId),
      ]);

      // ── Step 2: Compute team-level expected goals ──────────────────────────
      const homeStr = teamStrengthFromMatches(homeMatches, homeId, eloRatings);
      const awayStr = teamStrengthFromMatches(awayMatches, awayId, eloRatings);
      const { lambdaHome, lambdaAway } = expectedGoals(homeStr, awayStr);

      const homeGoalRate = homeStr.fromElo ? lambdaHome : homeStr.attack * 1.30;
      const awayGoalRate = awayStr.fromElo ? lambdaAway : awayStr.attack * 1.30;

      // Team-level shot simulation
      const teamShots = teamShotsPrediction(lambdaHome, lambdaAway, 8000);

      // ── Step 3: Load squads + scorers for player shots ─────────────────────
      let homeSquad = [], awaySquad = [], scorers = [];

      if (hasApiKey()) {
        setLoadingMsg('Cargando plantillas y goleadores...');
        try {
          [homeSquad, awaySquad, scorers] = await Promise.all([
            fetchTeamSquad(homeId),
            fetchTeamSquad(awayId),
            fetchScorers('WC', 50).catch(() => []),
          ]);
          setApiStatus(prev => ({ ...prev, ok: true }));
        } catch (e) {
          // Squads not critical — continue with team-level data
          console.warn('Squad fetch failed:', e.message);
        }
      }

      // ── Step 4: Build player lists ─────────────────────────────────────────
      const homePlayers = buildPlayerList({
        squad: homeSquad, scorers, teamId: homeId,
        teamLambda: lambdaHome, teamGoalRate: homeGoalRate,
      });
      const awayPlayers = buildPlayerList({
        squad: awaySquad, scorers, teamId: awayId,
        teamLambda: lambdaAway, teamGoalRate: awayGoalRate,
      });

      setResult({
        ...teamShots, lambdaHome, lambdaAway,
        homePlayers, awayPlayers,
        hasSquadData: homeSquad.length > 0 || awaySquad.length > 0,
        hasScorerData: scorers.length > 0,
      });
    } catch (e) {
      setError(e.message ?? 'Error al calcular disparos.');
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }

  const homeTeam = displayTeams.find(t => t.id === homeId);
  const awayTeam = displayTeams.find(t => t.id === awayId);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <SectionTitle>Predicción de disparos por partido</SectionTitle>
        <div className="controls-grid">
          <TeamSelector teams={displayTeams} value={homeId} onChange={setHomeId}
            label="🏠 Local" excludeId={awayId} />
          <span className="vs-label" style={{ color: '#3a5070', fontSize: 20, paddingBottom: 8 }}>vs</span>
          <TeamSelector teams={displayTeams} value={awayId} onChange={setAwayId}
            label="✈️ Visitante" excludeId={homeId} />
          <button className="btn-primary" onClick={runShots}
            disabled={loading || !homeId || !awayId}
            style={{ paddingTop: 10, paddingBottom: 10 }}>
            {loading ? <><Spinner size={16} />{loadingMsg ? '' : ' Calculando...'}</> : '⚡ Calcular'}
          </button>
        </div>
        {loading && loadingMsg && (
          <div style={{ fontSize: 12, color: '#5a7a9a', marginTop: 8 }}>⏳ {loadingMsg}</div>
        )}
        <ErrorBox message={error} />
      </div>

      {!result ? (
        <EmptyState icon="⚽" title="Selecciona un partido y pulsa Calcular"
          sub="Muestra disparos totales por equipo y estimación individual para todos los jugadores de la plantilla" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Team-level shots ─────────────────────────────────────────── */}
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
                    <StatCard label="Disparos totales"  value={d.shots.mean}         sub={`± ${d.shots.std}`}         color={color} />
                    <StatCard label="A puerta"          value={d.shotsOnTarget.mean} sub={`± ${d.shotsOnTarget.std}`} color={color} />
                  </div>
                  <ShotsBar label="Disparos totales"  mean={d.shots.mean}         std={d.shots.std}         max={26} color={color} />
                  <ShotsBar label="Disparos a puerta" mean={d.shotsOnTarget.mean} std={d.shotsOnTarget.std} max={12} color={color} />
                  <div style={{ fontSize: 11, color: '#3a5070', marginTop: 4 }}>
                    xG estimado: <span style={{ color, fontFamily: 'monospace' }}>{lambda?.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Player shots tables ──────────────────────────────────────── */}
          {result.hasSquadData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <SectionTitle
                  sub={`${result.hasScorerData ? 'Enriquecido con datos de goleadores WC 2026 · ' : ''}Disparos estimados basados en posición y xG del equipo`}>
                  Disparos por jugador
                </SectionTitle>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  {/* Home players */}
                  <PlayerTable
                    players={result.homePlayers}
                    color="#00D4AA"
                    title={homeTeam?.name ?? 'Local'}
                    showAll={showAllHome}
                    onToggleAll={() => setShowAllHome(p => !p)}
                  />
                  {/* Away players */}
                  <PlayerTable
                    players={result.awayPlayers}
                    color="#F5A623"
                    title={awayTeam?.name ?? 'Visitante'}
                    showAll={showAllAway}
                    onToggleAll={() => setShowAllAway(p => !p)}
                  />
                </div>

                <div style={{ fontSize: 11, color: '#3a5070', marginTop: 16, lineHeight: 1.7 }}>
                  <strong style={{ color: '#5a7a9a' }}>Leyenda:</strong>
                  {' '}⚽ = goles reales en WC 2026 · POR=Portero · DEF=Defensa · CEN=Centrocampista · DEL=Delantero
                  {' '}· <strong>% ataque</strong> = participación estimada en el ataque del equipo
                </div>
              </div>

              <div style={{ fontSize: 12, color: '#3a5070', textAlign: 'center' }}>
                ⚠️ Disparos estimados estadísticamente · Los datos reales de disparos no están disponibles en el tier gratuito de football-data.org
              </div>
            </div>
          ) : (
            <div className="card">
              <div style={{ fontSize: 13, color: '#5a7a9a', textAlign: 'center', padding: 20 }}>
                {hasApiKey()
                  ? '📡 Las plantillas de estos equipos no están disponibles en la API en este momento.'
                  : '💡 Agrega tu API key en ⚙️ Configuración para ver las plantillas completas con estimaciones de disparos por jugador.'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

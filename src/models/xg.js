import { clamp } from './utils.js';
import { eloStrengthFactor } from './elo.js';
import { poissonPrediction } from './poisson.js';

const BASE_ELO    = 1500;
const BASE_LAMBDA = 1.30;
const RECENT_N    = 15;

/**
 * Approximates xG from goals adjusted for opponent quality.
 * Falls back to ELO estimate (with a different formula than Poisson/Form)
 * so it gives distinct probabilities even without match history.
 */
function approximateXG(matches, teamId, eloRatings) {
  const valid = matches
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .slice(-RECENT_N);

  if (valid.length === 0) {
    // ELO fallback: weight attack and defense asymmetrically (distinct from other models)
    const f = eloStrengthFactor(teamId, eloRatings);
    return {
      xgFor:     clamp(BASE_LAMBDA * Math.pow(f, 0.70), 0.20, 5.0),   // sublinear attack
      xgAgainst: clamp(BASE_LAMBDA * Math.pow(1/f, 0.85), 0.20, 5.0), // steeper defense
      fromElo: true,
    };
  }

  let wXGFor = 0, wXGAgainst = 0, wTotal = 0;
  valid.forEach((m, i, arr) => {
    const w      = Math.pow(0.90, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    const gf     = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga     = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const oppId  = isHome ? m.awayTeam?.id  : m.homeTeam?.id;
    const oppElo = (eloRatings instanceof Map ? eloRatings.get(oppId) : undefined) ?? BASE_ELO;
    const qualMult = clamp(oppElo / BASE_ELO, 0.60, 1.80);
    wXGFor    += gf * qualMult * w;
    wXGAgainst += ga * qualMult * w;
    wTotal    += w;
  });

  return {
    xgFor:     clamp(wXGFor     / wTotal, 0.20, 5.0),
    xgAgainst: clamp(wXGAgainst / wTotal, 0.20, 5.0),
    fromElo:   false,
  };
}

export function xgPrediction(homeMatches, awayMatches, homeId, awayId, eloRatings) {
  const homeXG = approximateXG(homeMatches, homeId, eloRatings);
  const awayXG = approximateXG(awayMatches, awayId, eloRatings);

  const lambdaHome = clamp(0.65 * homeXG.xgFor + 0.35 * awayXG.xgAgainst, 0.20, 5.0);
  const lambdaAway = clamp(0.65 * awayXG.xgFor + 0.35 * homeXG.xgAgainst, 0.20, 5.0);

  return {
    ...poissonPrediction(lambdaHome, lambdaAway),
    lambdaHome,
    lambdaAway,
    xgHome: Math.round(homeXG.xgFor * 100) / 100,
    xgAway: Math.round(awayXG.xgFor * 100) / 100,
    fromElo: homeXG.fromElo && awayXG.fromElo,
  };
}

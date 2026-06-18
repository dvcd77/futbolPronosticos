import { clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const BASE_ELO = 1500;
const BASE_LAMBDA = 1.30;
const RECENT_N = 15;

/**
 * Approximates xG using goals scored/conceded adjusted for opponent ELO quality.
 * Without real xG data, we adjust raw goals by opponent quality:
 *   xG_adj = goals × (opponentElo / avgElo)^quality_weight
 */
function approximateXG(matches, teamId, eloRatings, opponentSide = 'both') {
  const valid = matches
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .slice(-RECENT_N);

  if (valid.length === 0) return { xgFor: BASE_LAMBDA, xgAgainst: BASE_LAMBDA };

  let wXGFor = 0, wXGAgainst = 0, wTotal = 0;

  valid.forEach((m, i, arr) => {
    const w = Math.pow(0.90, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const oppId = isHome ? m.awayTeam?.id : m.homeTeam?.id;
    const oppElo = eloRatings?.get(oppId) ?? BASE_ELO;

    // Quality multiplier: scoring vs strong opponent = more xG value
    const qualityMult = clamp(oppElo / BASE_ELO, 0.6, 1.8);

    wXGFor += gf * qualityMult * w;
    wXGAgainst += ga * qualityMult * w;
    wTotal += w;
  });

  return {
    xgFor: clamp(wXGFor / wTotal, 0.20, 5.0),
    xgAgainst: clamp(wXGAgainst / wTotal, 0.20, 5.0),
  };
}

/**
 * xG-based prediction using opponent-quality adjusted goals.
 */
export function xgPrediction(homeMatches, awayMatches, homeId, awayId, eloRatings) {
  const homeXG = approximateXG(homeMatches, homeId, eloRatings);
  const awayXG = approximateXG(awayMatches, awayId, eloRatings);

  // Combine own xGFor with opponent xGAgainst
  const lambdaHome = clamp(0.65 * homeXG.xgFor + 0.35 * awayXG.xgAgainst, 0.20, 5.0);
  const lambdaAway = clamp(0.65 * awayXG.xgFor + 0.35 * homeXG.xgAgainst, 0.20, 5.0);

  const details = poissonPrediction(lambdaHome, lambdaAway);

  return {
    ...details,
    lambdaHome,
    lambdaAway,
    xgHome: Math.round(homeXG.xgFor * 100) / 100,
    xgAway: Math.round(awayXG.xgFor * 100) / 100,
  };
}

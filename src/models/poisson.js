import { poissonPmf, poissonCdf, dixonColes, clamp } from './utils.js';
import { eloStrengthFactor } from './elo.js';

const BASE_LAMBDA = 1.30;
const MAX_GOALS   = 9;
const DC_RHO      = -0.10;

/**
 * Compute attack/defense strength from match history.
 * Falls back to ELO-based estimate when no matches are available,
 * so the model gives meaningful (non-identical) output without history.
 */
export function teamStrengthFromMatches(matches, teamId, eloRatings = null) {
  const valid = matches.filter(m =>
    m.score?.fullTime?.home != null && m.score?.fullTime?.away != null &&
    m.status === 'FINISHED'
  );

  if (valid.length === 0) {
    // ELO fallback: above-average teams attack more and concede less
    const f = eloStrengthFactor(teamId, eloRatings);
    return { attack: f, defense: 1 / f, fromElo: true };
  }

  let wScored = 0, wConceded = 0, wTotal = 0;
  valid.slice(-30).forEach((m, i, arr) => {
    const w = Math.pow(0.92, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    wScored   += (isHome ? m.score.fullTime.home : m.score.fullTime.away) * w;
    wConceded += (isHome ? m.score.fullTime.away : m.score.fullTime.home) * w;
    wTotal    += w;
  });

  return {
    attack:  clamp((wScored   / wTotal) / BASE_LAMBDA, 0.30, 4.0),
    defense: clamp((wConceded / wTotal) / BASE_LAMBDA, 0.30, 4.0),
    fromElo: false,
    matchCount: valid.length,
  };
}

export function expectedGoals(homeStr, awayStr) {
  return {
    lambdaHome: clamp(BASE_LAMBDA * homeStr.attack * awayStr.defense, 0.20, 6.0),
    lambdaAway: clamp(BASE_LAMBDA * awayStr.attack * homeStr.defense, 0.20, 6.0),
  };
}

export function poissonPrediction(lambdaHome, lambdaAway) {
  let home = 0, draw = 0, away = 0;
  const scores = {};
  let scoreSum = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const raw = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      const dc  = dixonColes(h, a, lambdaHome, lambdaAway, DC_RHO);
      const p   = Math.max(0, raw * dc);
      scores[`${h}-${a}`] = p;
      scoreSum += p;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }

  const tot = home + draw + away;
  const normalScores = {};
  for (const [k, v] of Object.entries(scores)) normalScores[k] = v / scoreSum;

  const totalLambda = lambdaHome + lambdaAway;
  const over15 = 1 - poissonCdf(1, totalLambda);
  const over25 = 1 - poissonCdf(2, totalLambda);
  const over35 = 1 - poissonCdf(3, totalLambda);
  const btts   = (1 - poissonPmf(0, lambdaHome)) * (1 - poissonPmf(0, lambdaAway));

  const htLH = lambdaHome * 0.42;
  const htLA = lambdaAway * 0.42;
  let htHome = 0, htDraw = 0, htAway = 0;
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = poissonPmf(h, htLH) * poissonPmf(a, htLA);
      if (h > a) htHome += p;
      else if (h === a) htDraw += p;
      else htAway += p;
    }
  }
  const htTot = htHome + htDraw + htAway || 1;

  return {
    home: home / tot,
    draw: draw / tot,
    away: away / tot,
    scores: normalScores,
    over:  { 1.5: over15, 2.5: over25, 3.5: over35 },
    under: { 1.5: 1-over15, 2.5: 1-over25, 3.5: 1-over35 },
    btts,
    halfTime: { home: htHome/htTot, draw: htDraw/htTot, away: htAway/htTot },
    lambdaHome,
    lambdaAway,
  };
}

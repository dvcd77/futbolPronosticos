import { poissonPmf, poissonCdf, dixonColes, clamp } from './utils.js';

const BASE_LAMBDA = 1.30; // Average goals per team in international football (WC)
const MAX_GOALS = 9;
const DC_RHO = -0.10;

/**
 * Compute attack/defense strength from match history for a given team.
 * Returns { attack, defense } relative to BASE_LAMBDA.
 */
export function teamStrengthFromMatches(matches, teamId) {
  const valid = matches.filter(m =>
    m.score?.fullTime?.home != null && m.score?.fullTime?.away != null &&
    m.status === 'FINISHED'
  );
  if (valid.length === 0) return { attack: 1, defense: 1 };

  let wScored = 0, wConceded = 0, wTotal = 0;
  valid.slice(-30).forEach((m, i, arr) => {
    const w = Math.pow(0.92, arr.length - 1 - i); // exponential decay
    const isHome = m.homeTeam?.id === teamId;
    const scored = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const conceded = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    wScored += scored * w;
    wConceded += conceded * w;
    wTotal += w;
  });

  return {
    attack: clamp((wScored / wTotal) / BASE_LAMBDA, 0.3, 4.0),
    defense: clamp((wConceded / wTotal) / BASE_LAMBDA, 0.3, 4.0),
  };
}

/**
 * Expected goals for each team using Dixon-Coles bivariate Poisson.
 */
export function expectedGoals(homeStr, awayStr) {
  return {
    lambdaHome: clamp(BASE_LAMBDA * homeStr.attack * awayStr.defense, 0.20, 6.0),
    lambdaAway: clamp(BASE_LAMBDA * awayStr.attack * homeStr.defense, 0.20, 6.0),
  };
}

/**
 * Full probability distribution from expected goals.
 * Returns 1X2, most-likely scores, over/under, btts, half-time 1X2.
 */
export function poissonPrediction(lambdaHome, lambdaAway) {
  let home = 0, draw = 0, away = 0;
  const scores = {};
  let scoreSum = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const raw = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      const dc = dixonColes(h, a, lambdaHome, lambdaAway, DC_RHO);
      const p = Math.max(0, raw * dc);
      scores[`${h}-${a}`] = p;
      scoreSum += p;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }

  // Normalize
  const tot = home + draw + away;
  const normalScores = {};
  for (const [k, v] of Object.entries(scores)) normalScores[k] = v / scoreSum;

  // Over/Under
  const totalLambda = lambdaHome + lambdaAway;
  const over15 = 1 - poissonCdf(1, totalLambda);
  const over25 = 1 - poissonCdf(2, totalLambda);
  const over35 = 1 - poissonCdf(3, totalLambda);

  // BTTS (both teams to score)
  const btts = (1 - poissonPmf(0, lambdaHome)) * (1 - poissonPmf(0, lambdaAway));

  // Half-time: use 42% of expected goals per half
  const htLH = lambdaHome * 0.42;
  const htLA = lambdaAway * 0.42;
  let htHome = 0, htDraw = 0, htAway = 0;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const p = poissonPmf(h, htLH) * poissonPmf(a, htLA);
      if (h > a) htHome += p;
      else if (h === a) htDraw += p;
      else htAway += p;
    }
  }

  return {
    home: home / tot,
    draw: draw / tot,
    away: away / tot,
    scores: normalScores,
    over: { 1.5: over15, 2.5: over25, 3.5: over35 },
    under: { 1.5: 1 - over15, 2.5: 1 - over25, 3.5: 1 - over35 },
    btts,
    halfTime: { home: htHome, draw: htDraw, away: htAway },
    lambdaHome,
    lambdaAway,
  };
}

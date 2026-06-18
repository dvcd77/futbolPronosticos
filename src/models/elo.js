import { eloToWinProb, clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const DEFAULT_ELO = 1500;
const K_WORLD_CUP = 40;
const K_OFFICIAL = 30;
const K_FRIENDLY = 20;
const HOME_ADVANTAGE = 0; // World Cup = neutral venue, no home advantage

function kFactor(m) {
  const comp = m.competition?.code || '';
  if (['WC', 'EC', 'CA'].includes(comp)) return K_WORLD_CUP;
  if (m.status === 'FINISHED') return K_OFFICIAL;
  return K_FRIENDLY;
}

function resultFromScores(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 1;
  if (homeGoals === awayGoals) return 0.5;
  return 0;
}

/**
 * Build ELO ratings table from a flat array of historical matches.
 * Returns Map<teamId, eloRating>.
 */
export function buildEloRatings(matches) {
  const ratings = new Map();
  const getElo = id => ratings.get(id) ?? DEFAULT_ELO;

  const sorted = [...matches]
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  for (const m of sorted) {
    const hId = m.homeTeam?.id;
    const aId = m.awayTeam?.id;
    if (!hId || !aId) continue;

    const eloH = getElo(hId);
    const eloA = getElo(aId);
    const diff = eloH - eloA + HOME_ADVANTAGE;
    const expectedH = eloToWinProb(diff);
    const result = resultFromScores(m.score.fullTime.home, m.score.fullTime.away);
    const K = kFactor(m);

    ratings.set(hId, eloH + K * (result - expectedH));
    ratings.set(aId, eloA + K * ((1 - result) - (1 - expectedH)));
  }

  return ratings;
}

/**
 * Get win probabilities from ELO ratings for a matchup.
 * Converts raw win/loss to a 3-way (home/draw/away) via Bradley-Terry model.
 */
export function eloPrediction(homeId, awayId, eloRatings) {
  const eloH = eloRatings.get(homeId) ?? DEFAULT_ELO;
  const eloA = eloRatings.get(awayId) ?? DEFAULT_ELO;
  const diff = eloH - eloA;

  // Win probability (2-way) from ELO difference
  const pHome2w = eloToWinProb(diff);
  const pAway2w = 1 - pHome2w;

  // Convert to 3-way using empirical draw rate (international football ≈ 22%)
  // Draw probability correlates inversely with abs(diff)
  const drawBase = 0.22 * Math.exp(-Math.abs(diff) / 500);
  const drawProb = clamp(drawBase, 0.04, 0.32);

  const homeProb = pHome2w * (1 - drawProb);
  const awayProb = pAway2w * (1 - drawProb);

  // Reverse-engineer expected goals from ELO to allow Monte Carlo
  // Use ELO win prob to estimate goal ratio
  const goalRatioHome = clamp(1 + (diff / 400), 0.4, 2.5);
  const BASE = 1.30;
  const lambdaHome = clamp(BASE * goalRatioHome, 0.3, 4.5);
  const lambdaAway = clamp(BASE / goalRatioHome, 0.3, 4.5);

  const details = poissonPrediction(lambdaHome, lambdaAway);

  return {
    home: homeProb,
    draw: drawProb,
    away: awayProb,
    scores: details.scores,
    over: details.over,
    under: details.under,
    btts: details.btts,
    halfTime: details.halfTime,
    lambdaHome,
    lambdaAway,
    eloHome: Math.round(eloH),
    eloAway: Math.round(eloA),
    eloDiff: Math.round(diff),
  };
}

export function getElo(teamId, ratings) {
  return Math.round(ratings.get(teamId) ?? DEFAULT_ELO);
}

import { eloToWinProb, clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const DEFAULT_ELO = 1500;
const K_WORLD_CUP = 40;
const K_OFFICIAL  = 30;
const K_FRIENDLY  = 15;
const HOME_ADVANTAGE = 0; // WC = neutral venue

// Competition codes treated as major tournaments (K=40)
const TOURNAMENT_CODES = new Set(['WC', 'EC', 'CA', 'UEFA_NL', 'CONC', 'AFCON', 'ACN', 'GOLD']);
// Known friendly / low-stakes competition codes (K=15)
const FRIENDLY_CODES   = new Set(['INT', 'FRL', 'FRLG', 'TEST', 'FR']);

function kFactor(m) {
  const code = m.competition?.code ?? '';
  if (TOURNAMENT_CODES.has(code)) return K_WORLD_CUP;
  if (FRIENDLY_CODES.has(code))   return K_FRIENDLY;
  // Default: official competition (league/cup)
  return K_OFFICIAL;
}

function resultFromScores(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 1;
  if (homeGoals === awayGoals) return 0.5;
  return 0;
}

/**
 * Build ELO ratings from match history.
 * Deduplicates by match ID to avoid processing the same game twice
 * when both teams' histories are merged.
 * Returns Map<teamId, eloRating>.
 */
export function buildEloRatings(matches) {
  const ratings = new Map();
  const getElo = id => ratings.get(id) ?? DEFAULT_ELO;

  // Deduplicate by match ID, then sort chronologically
  const seen = new Set();
  const sorted = matches
    .filter(m => {
      if (!m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return m.score?.fullTime?.home != null && m.status === 'FINISHED';
    })
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  for (const m of sorted) {
    const hId = m.homeTeam?.id;
    const aId = m.awayTeam?.id;
    if (!hId || !aId || hId === aId) continue;

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
 * 3-way match probability from ELO difference.
 * Uses a dynamic draw rate that decreases as the ELO gap widens.
 */
export function eloPrediction(homeId, awayId, eloRatings) {
  const eloH = eloRatings.get(homeId) ?? DEFAULT_ELO;
  const eloA = eloRatings.get(awayId) ?? DEFAULT_ELO;
  const diff = eloH - eloA;

  const pHome2w = eloToWinProb(diff);
  const pAway2w = 1 - pHome2w;

  // Draw rate decreases as abs(diff) grows
  const drawProb = clamp(0.23 * Math.exp(-Math.abs(diff) / 480), 0.04, 0.32);

  const homeProb = pHome2w * (1 - drawProb);
  const awayProb = pAway2w * (1 - drawProb);

  // Map ELO difference to expected goals for score distribution
  const goalRatioHome = clamp(1 + diff / 380, 0.4, 2.6);
  const BASE = 1.30;
  const lambdaHome = clamp(BASE * goalRatioHome, 0.25, 4.5);
  const lambdaAway = clamp(BASE / goalRatioHome, 0.25, 4.5);

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

/**
 * Returns an attack/defense factor based on ELO rating.
 * Used as fallback when a team has no match history.
 * ELO 1500 (average) → 1.0, ELO 1800 → 1.5, ELO 1200 → 0.5
 */
export function eloStrengthFactor(teamId, eloRatings) {
  const elo = (eloRatings instanceof Map ? eloRatings.get(teamId) : undefined) ?? DEFAULT_ELO;
  return clamp(1 + (elo - DEFAULT_ELO) / 600, 0.40, 2.50);
}

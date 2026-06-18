/**
 * Lightweight ML model: feature-weighted regression.
 * Key fix: ELO feature is now computed BEFORE the early return,
 * so the model uses real ELO data even without match history.
 */
import { clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const BASE_ELO    = 1500;
const BASE_LAMBDA = 1.30;

// Feature importance weights (research-calibrated)
const W = {
  elo:     0.32,
  attack:  0.24,
  defense: 0.20,
  form:    0.18,
  goals:   0.06,
};

function extractFeatures(matches, teamId, eloRatings) {
  // ── ELO feature computed FIRST (before checking match availability) ──────────
  const elo     = (eloRatings instanceof Map ? eloRatings.get(teamId) : undefined) ?? BASE_ELO;
  const eloNorm = clamp((elo - 1300) / 500, 0, 1);  // [0,1] where 0=weak, 1=very strong

  const valid = matches
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .slice(-15);

  if (valid.length === 0) {
    // ELO-informed fallback: use ELO to estimate attack/defense/form
    // This makes ML give DIFFERENT results from other models even without history
    const eloFactor = clamp((elo - BASE_ELO) / 600 + 1, 0.4, 2.5);
    return {
      elo:     eloNorm,
      attack:  clamp(eloNorm * 0.9 + 0.05, 0, 1),
      defense: clamp(eloNorm * 0.8 + 0.10, 0, 1),
      form:    clamp(eloNorm * 0.7 + 0.15, 0, 1),
      goals:   BASE_LAMBDA * eloFactor,
      fromElo: true,
    };
  }

  let wFor = 0, wAgainst = 0, wWins = 0, wTotal = 0;
  valid.forEach((m, i, arr) => {
    const w      = Math.pow(0.90, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    const gf     = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga     = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    wFor      += gf * w;
    wAgainst  += ga * w;
    wWins     += (gf > ga ? 1 : gf === ga ? 0.5 : 0) * w;
    wTotal    += w;
  });

  const goalsFor     = wFor     / wTotal;
  const goalsAgainst = wAgainst / wTotal;
  const formRate     = wWins    / wTotal;

  return {
    elo:     eloNorm,
    attack:  clamp(goalsFor     / (BASE_LAMBDA * 2), 0, 1),
    defense: clamp(1 - goalsAgainst / (BASE_LAMBDA * 2), 0, 1),
    form:    formRate,
    goals:   goalsFor,
    fromElo: false,
  };
}

function featureScore(feat) {
  return (
    W.elo     * feat.elo     +
    W.attack  * feat.attack  +
    W.defense * feat.defense +
    W.form    * feat.form    +
    W.goals   * clamp(feat.goals / (BASE_LAMBDA * 2), 0, 1)
  );
}

export function mlPrediction(homeMatches, awayMatches, homeId, awayId, eloRatings) {
  const homeFeat = extractFeatures(homeMatches, homeId, eloRatings);
  const awayFeat = extractFeatures(awayMatches, awayId, eloRatings);

  const homeScore  = featureScore(homeFeat);
  const awayScore  = featureScore(awayFeat);
  const totalScore = homeScore + awayScore || 1;

  const power = homeScore / totalScore;
  const lambdaHome = clamp(BASE_LAMBDA * (0.40 + power * 1.20), 0.20, 5.0);
  const lambdaAway = clamp(BASE_LAMBDA * (0.40 + (1-power) * 1.20), 0.20, 5.0);

  return {
    ...poissonPrediction(lambdaHome, lambdaAway),
    lambdaHome,
    lambdaAway,
    featureScoreHome: Math.round(homeScore * 100),
    featureScoreAway: Math.round(awayScore * 100),
    fromElo: homeFeat.fromElo && awayFeat.fromElo,
  };
}

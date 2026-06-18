/**
 * Lightweight ML model: feature-weighted linear regression.
 * Simulates a trained model using heuristic weights derived from
 * football analytics research (no actual training needed).
 */
import { clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const BASE_ELO = 1500;
const BASE_LAMBDA = 1.30;

// Feature importance weights (as if learned from thousands of WC matches)
const W = {
  elo:    0.32,   // ELO difference strongest predictor
  attack: 0.24,   // Attacking strength
  defense:0.20,   // Defensive solidity (inverted for opponent)
  form:   0.18,   // Recent form
  goals:  0.06,   // Goals per game baseline
};

function extractFeatures(matches, teamId, eloRatings) {
  const valid = matches
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .slice(-15);

  if (valid.length === 0) return { elo: 0.5, attack: 0.5, defense: 0.5, form: 0.5, goals: 1.0 };

  const elo = (eloRatings?.get(teamId) ?? BASE_ELO);
  const eloNorm = clamp((elo - 1300) / 500, 0, 1); // normalize to [0,1]

  let wFor = 0, wAgainst = 0, wWins = 0, wTotal = 0;
  valid.forEach((m, i, arr) => {
    const w = Math.pow(0.90, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    wFor += gf * w;
    wAgainst += ga * w;
    wWins += (gf > ga ? 1 : gf === ga ? 0.5 : 0) * w;
    wTotal += w;
  });

  const goalsFor = wFor / wTotal;
  const goalsAgainst = wAgainst / wTotal;
  const formRate = wWins / wTotal;

  return {
    elo: eloNorm,
    attack: clamp(goalsFor / (BASE_LAMBDA * 2), 0, 1),
    defense: clamp(1 - goalsAgainst / (BASE_LAMBDA * 2), 0, 1),
    form: formRate,
    goals: goalsFor,
  };
}

function featureScore(feat) {
  return W.elo * feat.elo + W.attack * feat.attack +
         W.defense * feat.defense + W.form * feat.form +
         W.goals * clamp(feat.goals / (BASE_LAMBDA * 2), 0, 1);
}

export function mlPrediction(homeMatches, awayMatches, homeId, awayId, eloRatings) {
  const homeFeat = extractFeatures(homeMatches, homeId, eloRatings);
  const awayFeat = extractFeatures(awayMatches, awayId, eloRatings);

  const homeScore = featureScore(homeFeat);
  const awayScore = featureScore(awayFeat);
  const totalScore = homeScore + awayScore;

  // Convert scores to expected goals using a power function
  // More balanced teams → closer to base rate
  const power = homeScore / (totalScore || 1);
  const lambdaHome = clamp(BASE_LAMBDA * (0.4 + power * 1.2), 0.20, 5.0);
  const lambdaAway = clamp(BASE_LAMBDA * (0.4 + (1 - power) * 1.2), 0.20, 5.0);

  const details = poissonPrediction(lambdaHome, lambdaAway);

  return {
    ...details,
    lambdaHome,
    lambdaAway,
    featureScoreHome: Math.round(homeScore * 100),
    featureScoreAway: Math.round(awayScore * 100),
  };
}

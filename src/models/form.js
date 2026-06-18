import { clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const DECAY = 0.88;       // exponential decay per match (older = less weight)
const RECENT_N = 12;      // consider last N matches
const BASE_LAMBDA = 1.30;

/**
 * Compute form rating for a team from recent matches.
 * Returns { goalsFor, goalsAgainst, formScore, matchCount }
 */
function teamForm(matches, teamId) {
  const valid = matches
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .slice(-RECENT_N);

  if (valid.length === 0) return { goalsFor: BASE_LAMBDA, goalsAgainst: BASE_LAMBDA, formScore: 0.5, matchCount: 0 };

  let wFor = 0, wAgainst = 0, wPoints = 0, wTotal = 0;

  valid.forEach((m, i, arr) => {
    const w = Math.pow(DECAY, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const pts = gf > ga ? 1 : gf === ga ? 0.5 : 0; // 1=win, 0.5=draw, 0=loss

    wFor += gf * w;
    wAgainst += ga * w;
    wPoints += pts * w;
    wTotal += w;
  });

  return {
    goalsFor: wFor / wTotal,
    goalsAgainst: wAgainst / wTotal,
    formScore: wPoints / wTotal,   // 0..1
    matchCount: valid.length,
  };
}

/**
 * Form-based prediction.
 * Combines recent goals-per-game with form score to derive expected goals,
 * then uses Poisson for the full distribution.
 */
export function formPrediction(homeMatches, awayMatches, homeId, awayId) {
  const homeForm = teamForm(homeMatches, homeId);
  const awayForm = teamForm(awayMatches, awayId);

  // Form-adjusted expected goals:
  // lambda = avg(team's goalsFor, opponent's goalsAgainst)
  // weighted 60% own attack, 40% opponent's defense weakness
  const rawHome = 0.60 * homeForm.goalsFor + 0.40 * awayForm.goalsAgainst;
  const rawAway = 0.60 * awayForm.goalsFor + 0.40 * homeForm.goalsAgainst;

  const lambdaHome = clamp(rawHome, 0.20, 5.0);
  const lambdaAway = clamp(rawAway, 0.20, 5.0);

  const details = poissonPrediction(lambdaHome, lambdaAway);

  return {
    ...details,
    formHome: homeForm,
    formAway: awayForm,
    lambdaHome,
    lambdaAway,
  };
}

/** Returns a form score 0–10 for display */
export function formDisplay(matches, teamId) {
  const f = teamForm(matches, teamId);
  return {
    score: Math.round(f.formScore * 10 * 10) / 10,
    matchCount: f.matchCount,
    goalsFor: Math.round(f.goalsFor * 10) / 10,
    goalsAgainst: Math.round(f.goalsAgainst * 10) / 10,
  };
}

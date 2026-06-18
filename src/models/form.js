import { clamp } from './utils.js';
import { eloStrengthFactor } from './elo.js';
import { poissonPrediction } from './poisson.js';

const DECAY      = 0.88;
const RECENT_N   = 12;
const BASE_LAMBDA = 1.30;

/**
 * Compute recent-form stats for a team.
 * Falls back to ELO estimate when no matches are available.
 * Uses more recent matches than the Poisson model (12 vs 30),
 * so the two models genuinely differ when data is present.
 */
function teamForm(matches, teamId, eloRatings = null) {
  const valid = matches
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .slice(-RECENT_N);

  if (valid.length === 0) {
    // ELO fallback — each model uses ELO differently, so results differ from Poisson
    const f = eloStrengthFactor(teamId, eloRatings);
    return {
      goalsFor:     clamp(BASE_LAMBDA * f,       0.20, 5.0),
      goalsAgainst: clamp(BASE_LAMBDA / f,       0.20, 5.0),
      formScore: clamp(0.35 + (f - 1) * 0.30, 0.05, 0.95),
      matchCount: 0,
      fromElo: true,
    };
  }

  let wFor = 0, wAgainst = 0, wPoints = 0, wTotal = 0;
  valid.forEach((m, i, arr) => {
    const w = Math.pow(DECAY, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    const gf  = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga  = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const pts = gf > ga ? 1 : gf === ga ? 0.5 : 0;
    wFor     += gf  * w;
    wAgainst += ga  * w;
    wPoints  += pts * w;
    wTotal   += w;
  });

  return {
    goalsFor:     wFor     / wTotal,
    goalsAgainst: wAgainst / wTotal,
    formScore:    wPoints  / wTotal,
    matchCount:   valid.length,
    fromElo:      false,
  };
}

/**
 * Form-based prediction.
 * Uses a different weighting scheme than Poisson (additive vs multiplicative),
 * giving genuinely different probability estimates.
 */
export function formPrediction(homeMatches, awayMatches, homeId, awayId, eloRatings = null) {
  const homeForm = teamForm(homeMatches, homeId, eloRatings);
  const awayForm = teamForm(awayMatches, awayId, eloRatings);

  // Additive combination (different from Poisson's multiplicative model)
  const lambdaHome = clamp(0.60 * homeForm.goalsFor + 0.40 * awayForm.goalsAgainst, 0.20, 5.0);
  const lambdaAway = clamp(0.60 * awayForm.goalsFor + 0.40 * homeForm.goalsAgainst, 0.20, 5.0);

  return {
    ...poissonPrediction(lambdaHome, lambdaAway),
    formHome:  homeForm,
    formAway:  awayForm,
    lambdaHome,
    lambdaAway,
  };
}

export function formDisplay(matches, teamId, eloRatings = null) {
  const f = teamForm(matches, teamId, eloRatings);
  return {
    score:        Math.round(f.formScore * 10 * 10) / 10,
    matchCount:   f.matchCount,
    goalsFor:     Math.round(f.goalsFor     * 10) / 10,
    goalsAgainst: Math.round(f.goalsAgainst * 10) / 10,
    fromElo:      f.fromElo,
  };
}

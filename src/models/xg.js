import { clamp } from './utils.js';
import { eloStrengthFactor } from './elo.js';
import { poissonPrediction } from './poisson.js';

const BASE_ELO    = 1500;
const BASE_LAMBDA = 1.30;
const RECENT_N    = 15;

/**
 * Estima el xG de un equipo con una jerarquía de 3 niveles de calidad:
 *
 *   1. xG REAL (vía API-Football) — el mejor. xG medido tiro a tiro por la
 *      fuente de datos, no inferido. Es la mejora individual más potente
 *      según la literatura (el modelo Maia subió la probabilidad de España
 *      un 29% con esta sola fuente). Se usa si `realXG` está presente.
 *   2. APROXIMACIÓN desde goles ajustados por calidad del rival — el del
 *      medio. Es lo que el modelo usaba siempre antes de tener xG real.
 *   3. Fallback ELO — el peor, pero garantiza una salida distinta cuando no
 *      hay ningún partido en el historial.
 *
 * @param {Array} matches - historial del equipo
 * @param {number} teamId
 * @param {Map} eloRatings
 * @param {Object|null} realXG - { xgForPer90, xgAgainstPer90, sampleSize } o null
 */
function estimateXG(matches, teamId, eloRatings, realXG = null) {
  // ── Nivel 1: xG real medido ────────────────────────────────────────────────
  if (realXG && realXG.xgForPer90 != null && realXG.xgAgainstPer90 != null) {
    return {
      xgFor:     clamp(realXG.xgForPer90,     0.20, 5.0),
      xgAgainst: clamp(realXG.xgAgainstPer90, 0.20, 5.0),
      source: 'real',
      sampleSize: realXG.sampleSize ?? null,
    };
  }

  const valid = matches
    .filter(m => m.score?.fullTime?.home != null && m.status === 'FINISHED')
    .slice(-RECENT_N);

  // ── Nivel 3: fallback ELO (sin historial) ──────────────────────────────────
  if (valid.length === 0) {
    const f = eloStrengthFactor(teamId, eloRatings);
    return {
      xgFor:     clamp(BASE_LAMBDA * Math.pow(f, 0.70), 0.20, 5.0),
      xgAgainst: clamp(BASE_LAMBDA * Math.pow(1/f, 0.85), 0.20, 5.0),
      source: 'elo',
    };
  }

  // ── Nivel 2: aproximación desde goles ajustados por rival ──────────────────
  let wXGFor = 0, wXGAgainst = 0, wTotal = 0;
  valid.forEach((m, i, arr) => {
    const w      = Math.pow(0.90, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    const gf     = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga     = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const oppId  = isHome ? m.awayTeam?.id  : m.homeTeam?.id;
    const oppElo = (eloRatings instanceof Map ? eloRatings.get(oppId) : undefined) ?? BASE_ELO;
    const qualMult = clamp(oppElo / BASE_ELO, 0.60, 1.80);
    wXGFor     += gf * qualMult * w;
    wXGAgainst += ga * qualMult * w;
    wTotal     += w;
  });

  return {
    xgFor:     clamp(wXGFor     / wTotal, 0.20, 5.0),
    xgAgainst: clamp(wXGAgainst / wTotal, 0.20, 5.0),
    source: 'approx',
  };
}

/**
 * Predicción basada en xG.
 *
 * @param {Object|null} realXGHome - xG real del local (o null para aproximar)
 * @param {Object|null} realXGAway - xG real del visitante (o null)
 */
export function xgPrediction(homeMatches, awayMatches, homeId, awayId, eloRatings, realXGHome = null, realXGAway = null) {
  const homeXG = estimateXG(homeMatches, homeId, eloRatings, realXGHome);
  const awayXG = estimateXG(awayMatches, awayId, eloRatings, realXGAway);

  const lambdaHome = clamp(0.65 * homeXG.xgFor + 0.35 * awayXG.xgAgainst, 0.20, 5.0);
  const lambdaAway = clamp(0.65 * awayXG.xgFor + 0.35 * homeXG.xgAgainst, 0.20, 5.0);

  return {
    ...poissonPrediction(lambdaHome, lambdaAway),
    lambdaHome,
    lambdaAway,
    xgHome: Math.round(homeXG.xgFor * 100) / 100,
    xgAway: Math.round(awayXG.xgFor * 100) / 100,
    xgSourceHome: homeXG.source, // 'real' | 'approx' | 'elo'
    xgSourceAway: awayXG.source,
    fromElo: homeXG.source === 'elo' && awayXG.source === 'elo',
    usesRealXG: homeXG.source === 'real' || awayXG.source === 'real',
  };
}

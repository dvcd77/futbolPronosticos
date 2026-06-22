/**
 * fifaRank.js — Modelo basado en el Ranking Mundial FIFA oficial.
 *
 * Desde agosto 2018, FIFA usa un sistema basado en ELO para su ranking,
 * así que reutilizamos eloToWinProb directamente sobre la diferencia de
 * puntos FIFA — es matemáticamente el mismo tipo de sistema que nuestro
 * modelo ELO propio, pero calculado por FIFA con TODOS los partidos
 * oficiales de cada selección (incluyendo AFCON, Copa América, Gold Cup,
 * clasificatorias, etc.) — exactamente los torneos que football-data.org
 * no cubre en su tier gratuito. Por eso este modelo es un complemento
 * valioso: no depende de qué competencias estén disponibles en nuestra
 * API de partidos.
 */
import { eloToWinProb, clamp } from './utils.js';
import { getFifaRanking } from '../data/fifaRanking.js';
import { poissonPrediction } from './poisson.js';

const BASE_LAMBDA = 1.30;
const DEFAULT_POINTS = 1400; // fallback si un equipo no está en la tabla

/**
 * Predicción basada puramente en el ranking FIFA de ambos equipos.
 * Devuelve la misma forma que los demás modelos para integrarse al ensemble.
 */
export function fifaRankPrediction(homeTla, awayTla) {
  const homeR = getFifaRanking(homeTla);
  const awayR = getFifaRanking(awayTla);

  const homePoints = homeR?.points ?? DEFAULT_POINTS;
  const awayPoints = awayR?.points ?? DEFAULT_POINTS;
  const diff = homePoints - awayPoints;

  // FIFA usa una escala de puntos similar a ELO (no idéntica) — usamos un
  // divisor algo mayor que el ELO clásico (400) para reflejar que la escala
  // de puntos FIFA es más comprimida en la práctica.
  const pHome2w = eloToWinProb(diff * (400 / 480));
  const pAway2w = 1 - pHome2w;

  const drawProb = clamp(0.23 * Math.exp(-Math.abs(diff) / 380), 0.04, 0.32);
  const homeProb = pHome2w * (1 - drawProb);
  const awayProb = pAway2w * (1 - drawProb);

  // Expected goals derivados de la diferencia de puntos (mismo enfoque que ELO)
  const goalRatioHome = clamp(1 + diff / 340, 0.4, 2.6);
  const lambdaHome = clamp(BASE_LAMBDA * goalRatioHome, 0.25, 4.5);
  const lambdaAway = clamp(BASE_LAMBDA / goalRatioHome, 0.25, 4.5);

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
    fifaRankHome: homeR?.rank ?? null,
    fifaRankAway: awayR?.rank ?? null,
    fifaPointsHome: Math.round(homePoints * 10) / 10,
    fifaPointsAway: Math.round(awayPoints * 10) / 10,
  };
}

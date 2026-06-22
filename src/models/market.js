/**
 * market.js — Modelo basado en el mercado de apuestas (The Odds API)
 *
 * A diferencia de los demás modelos (que derivan TODOS de la misma fuente:
 * goles históricos o ratings calculados de esos goles), el mercado de
 * apuestas incorpora información que ningún modelo casero puede ver:
 * lesiones de último momento, alineaciones filtradas, dinero de apostadores
 * profesionales con información privilegiada. Es la única señal genuinamente
 * independiente de las que tenemos disponibles gratis.
 *
 * Limitación: solo está disponible cuando el mercado ya abrió para ese
 * partido específico (normalmente días antes del encuentro), así que este
 * modelo frecuentemente NO estará disponible — el ensemble lo absorbe bien,
 * redistribuyendo su peso entre los modelos que sí tengan datos.
 */
import { clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const BASE_LAMBDA = 1.30;

/**
 * Convierte probabilidades implícitas del mercado (ya con el margen de
 * casa removido, ver oddsApi.js → impliedProbabilities) en una predicción
 * con la misma forma que los demás modelos.
 *
 * @param {Object} implied - { home, draw, away } probabilidades 0-1
 * @param {Object} meta - { bookmakerCount, vigPercent } informativo
 */
export function marketPrediction(implied, meta = {}) {
  const { home, draw, away } = implied;

  // Reverse-engineer expected goals desde la proporción de victoria 2-way
  // (mismo enfoque que ELO/FIFA: convertir probabilidad → ratio de goles)
  const pHome2w = home / (home + away || 1);
  const safeP = clamp(pHome2w, 0.02, 0.98); // evitar log(0) en casos extremos
  const diff = 400 * Math.log10(safeP / (1 - safeP));
  const goalRatioHome = clamp(1 + diff / 380, 0.4, 2.6);
  const lambdaHome = clamp(BASE_LAMBDA * goalRatioHome, 0.25, 4.5);
  const lambdaAway = clamp(BASE_LAMBDA / goalRatioHome, 0.25, 4.5);

  const details = poissonPrediction(lambdaHome, lambdaAway);

  return {
    // Las probabilidades 1X2 son las REALES del mercado, no recalculadas —
    // es la opinión agregada de las casas de apuestas, no debe diluirse.
    home, draw, away,
    scores: details.scores,
    over: details.over,
    under: details.under,
    btts: details.btts,
    halfTime: details.halfTime,
    lambdaHome,
    lambdaAway,
    bookmakerCount: meta.bookmakerCount ?? null,
    vigPercent: meta.vigPercent ?? null,
  };
}

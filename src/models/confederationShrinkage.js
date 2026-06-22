/**
 * confederationShrinkage.js — Shrinkage bayesiano hacia el promedio de confederación
 *
 * Problema que resuelve: cuando un equipo tiene pocos partidos reales
 * (Curaçao, Cabo Verde, Haití...), los demás modelos caen a un fallback de
 * ELO que usa 1500 (la media GLOBAL) como punto de partida — ignorando que,
 * por ejemplo, un equipo UEFA promedio es estructuralmente más fuerte que
 * un equipo OFC promedio. Este modelo usa la media de la CONFEDERACIÓN del
 * equipo como prior, que es más informativa que un default genérico.
 *
 * Técnica: shrinkage bayesiano clásico — el ELO "encogido" es una mezcla
 * entre el ELO propio del equipo y el promedio de su confederación,
 * ponderada por cuántos partidos reales tiene el equipo (más datos propios
 * = más confianza en el ELO propio; menos datos = más peso al promedio
 * grupal). Es la misma idea detrás de modelos jerárquicos bayesianos: las
 * observaciones individuales se "encogen" hacia la media del grupo cuando
 * hay poca evidencia individual.
 */
import { clamp, eloToWinProb } from './utils.js';
import { poissonPrediction } from './poisson.js';

const DEFAULT_ELO = 1500;
const BASE_LAMBDA = 1.30;
const FULL_CONFIDENCE_MATCHES = 15; // partidos reales para confiar 100% en el ELO propio

/**
 * Calcula el ELO promedio de cada confederación a partir de las ratings
 * actuales de los 48 equipos del Mundial.
 *
 * BUG CORREGIDO: la versión anterior incluía a TODOS los equipos en el
 * promedio, usando 1500 (default genérico) para los que aún no tienen
 * partidos cargados — en la práctica, la mayoría de los 48 equipos no
 * tienen rating real hasta que el usuario predice un partido con ellos,
 * así que el promedio quedaba diluido hacia 1500 casi siempre, anulando
 * el propósito del modelo (diferenciar confederaciones fuertes de débiles).
 * Ahora solo se cuentan los equipos que SÍ tienen un rating real cargado;
 * si una confederación entera no tiene ningún dato aún, recién ahí cae a
 * DEFAULT_ELO como último recurso.
 */
function computeConfederationAverages(allTeams, eloRatings) {
  const sums = {}, counts = {};
  allTeams.forEach(t => {
    if (!t.conf) return;
    if (!(eloRatings instanceof Map) || !eloRatings.has(t.id)) return; // sin dato real, no cuenta
    const elo = eloRatings.get(t.id);
    sums[t.conf] = (sums[t.conf] ?? 0) + elo;
    counts[t.conf] = (counts[t.conf] ?? 0) + 1;
  });
  const avgs = {};
  Object.keys(sums).forEach(conf => { avgs[conf] = sums[conf] / counts[conf]; });
  return avgs; // confederaciones sin ningún dato real simplemente no aparecen aquí
}

function shrinkElo(ownElo, matchCount, conf, confAverages) {
  const confAvg = confAverages[conf] ?? DEFAULT_ELO;
  const confidence = clamp(matchCount / FULL_CONFIDENCE_MATCHES, 0.10, 1.0);
  return confidence * ownElo + (1 - confidence) * confAvg;
}

/**
 * Predicción con ELO "encogido" hacia el promedio de confederación.
 *
 * @param {Object} homeTeam - { id, conf } del equipo local
 * @param {Object} awayTeam - { id, conf } del equipo visitante
 * @param {number} homeMatchCount - partidos reales con los que cuenta el local
 * @param {number} awayMatchCount - partidos reales con los que cuenta el visitante
 * @param {Map} eloRatings - ratings ELO actuales
 * @param {Array} allTeams - lista completa de equipos (para promedios por confederación)
 */
export function confederationShrinkagePrediction(homeTeam, awayTeam, homeMatchCount, awayMatchCount, eloRatings, allTeams) {
  if (!homeTeam?.conf || !awayTeam?.conf) return null; // sin confederación, no aplica

  const confAverages = computeConfederationAverages(allTeams, eloRatings);

  const eloHomeRaw = (eloRatings instanceof Map ? eloRatings.get(homeTeam.id) : undefined) ?? DEFAULT_ELO;
  const eloAwayRaw = (eloRatings instanceof Map ? eloRatings.get(awayTeam.id) : undefined) ?? DEFAULT_ELO;

  const eloHome = shrinkElo(eloHomeRaw, homeMatchCount ?? 0, homeTeam.conf, confAverages);
  const eloAway = shrinkElo(eloAwayRaw, awayMatchCount ?? 0, awayTeam.conf, confAverages);

  const diff = eloHome - eloAway;
  const pHome2w = eloToWinProb(diff);
  const drawProb = clamp(0.23 * Math.exp(-Math.abs(diff) / 480), 0.04, 0.32);
  const home = pHome2w * (1 - drawProb);
  const away = (1 - pHome2w) * (1 - drawProb);

  const goalRatioHome = clamp(1 + diff / 380, 0.4, 2.6);
  const lambdaHome = clamp(BASE_LAMBDA * goalRatioHome, 0.25, 4.5);
  const lambdaAway = clamp(BASE_LAMBDA / goalRatioHome, 0.25, 4.5);

  const details = poissonPrediction(lambdaHome, lambdaAway);

  return {
    home, draw: drawProb, away,
    scores: details.scores,
    over: details.over,
    under: details.under,
    btts: details.btts,
    halfTime: details.halfTime,
    lambdaHome,
    lambdaAway,
    confHome: homeTeam.conf,
    confAway: awayTeam.conf,
    confAvgEloHome: Math.round(confAverages[homeTeam.conf] ?? DEFAULT_ELO),
    confAvgEloAway: Math.round(confAverages[awayTeam.conf] ?? DEFAULT_ELO),
    shrunkEloHome: Math.round(eloHome),
    shrunkEloAway: Math.round(eloAway),
  };
}

/**
 * headToHead.js — Modelo de enfrentamientos directos
 *
 * Señal distinta a "forma general" o "rating": captura si UN equipo
 * específico históricamente le cuesta a OTRO equipo específico, más allá
 * de la fuerza relativa de ambos (ventajas tácticas, estilos que chocan
 * mal, factores psicológicos documentados en la literatura deportiva).
 *
 * Limitación honesta: la mayoría de pares de selecciones del Mundial nunca
 * se han enfrentado (ej. Curaçao vs Uzbekistán), así que este modelo
 * frecuentemente no estará disponible. Cuando SÍ hay historial, usa
 * shrinkage hacia el promedio neutro según el tamaño de muestra — con 1-2
 * enfrentamientos no debe pesar casi nada, con 5+ empieza a hablar fuerte.
 */
import { clamp } from './utils.js';
import { poissonPrediction } from './poisson.js';

const BASE_LAMBDA = 1.30;
const DECAY = 0.85;
const MAX_H2H = 10;          // máximo de enfrentamientos históricos a considerar
const FULL_CONFIDENCE_AT = 5; // partidos directos para confiar 100% en el patrón

/**
 * Busca enfrentamientos directos entre dos equipos específicos dentro de
 * un conjunto combinado de partidos (típicamente homeMatches + awayMatches
 * ya cargados). Dedupea por ID de partido, ya que un H2H real aparece en
 * el historial de AMBOS equipos.
 */
function findHeadToHeadMatches(allMatches, teamAId, teamBId) {
  const seen = new Set();
  return allMatches
    .filter(m => {
      if (!m.id || seen.has(m.id)) return false;
      const isFinished = m.score?.fullTime?.home != null && m.status === 'FINISHED';
      const isH2H = isFinished && (
        (m.homeTeam?.id === teamAId && m.awayTeam?.id === teamBId) ||
        (m.homeTeam?.id === teamBId && m.awayTeam?.id === teamAId)
      );
      if (isH2H) seen.add(m.id);
      return isH2H;
    })
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(-MAX_H2H);
}

/**
 * Predicción basada en el historial directo entre homeId y awayId.
 * Devuelve null si nunca se han enfrentado — el ensemble maneja esto
 * automáticamente, redistribuyendo el peso entre los modelos disponibles.
 */
export function headToHeadPrediction(allMatches, homeId, awayId) {
  const h2h = findHeadToHeadMatches(allMatches, homeId, awayId);
  if (h2h.length === 0) return null;

  let wHomeGoals = 0, wAwayGoals = 0, wTotal = 0;
  let homeWins = 0, draws = 0, awayWins = 0;

  h2h.forEach((m, i, arr) => {
    const w = Math.pow(DECAY, arr.length - 1 - i);
    const isHomeTeamHome = m.homeTeam?.id === homeId;
    const goalsForHome = isHomeTeamHome ? m.score.fullTime.home : m.score.fullTime.away;
    const goalsForAway = isHomeTeamHome ? m.score.fullTime.away : m.score.fullTime.home;

    wHomeGoals += goalsForHome * w;
    wAwayGoals += goalsForAway * w;
    wTotal += w;

    if (goalsForHome > goalsForAway) homeWins++;
    else if (goalsForHome === goalsForAway) draws++;
    else awayWins++;
  });

  const n = h2h.length;
  const confidence = clamp(n / FULL_CONFIDENCE_AT, 0.15, 1.0);

  // Shrinkage de los goles esperados hacia el promedio neutro (1.30/1.30)
  const rawLambdaHome = wHomeGoals / wTotal;
  const rawLambdaAway = wAwayGoals / wTotal;
  const lambdaHome = clamp(confidence * rawLambdaHome + (1 - confidence) * BASE_LAMBDA, 0.20, 5.0);
  const lambdaAway = clamp(confidence * rawLambdaAway + (1 - confidence) * BASE_LAMBDA, 0.20, 5.0);

  // Shrinkage del récord histórico (1X2) hacia tasas neutras
  const neutralDraw = 0.23;
  const rawHome = homeWins / n, rawDraw = draws / n, rawAway = awayWins / n;
  const home = confidence * rawHome + (1 - confidence) * ((1 - neutralDraw) / 2);
  const draw = confidence * rawDraw + (1 - confidence) * neutralDraw;
  const away = confidence * rawAway + (1 - confidence) * ((1 - neutralDraw) / 2);
  const tot = home + draw + away;

  const details = poissonPrediction(lambdaHome, lambdaAway);

  return {
    home: home / tot,
    draw: draw / tot,
    away: away / tot,
    scores: details.scores,
    over: details.over,
    under: details.under,
    btts: details.btts,
    halfTime: details.halfTime,
    lambdaHome,
    lambdaAway,
    h2hMatchCount: n,
    h2hRecord: { homeWins, draws, awayWins },
    confidencePercent: Math.round(confidence * 100),
  };
}

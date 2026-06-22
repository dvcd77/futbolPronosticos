/**
 * backtest.js — Motor de validación histórica de los modelos
 *
 * Evalúa qué tan bien predice cada modelo (y el ensemble) sobre partidos
 * cuyo resultado YA conocemos. La idea: para cada partido histórico,
 * reconstruir el pronóstico que el modelo HABRÍA hecho usando solo datos
 * ANTERIORES a ese partido, y comparar contra el resultado real vía RPS.
 *
 * CRÍTICO — prevención de data leakage: al evaluar el partido del día D,
 * solo se usan partidos jugados ANTES del día D para construir las fuerzas
 * de cada equipo. Si usáramos el partido mismo (o posteriores) para estimar
 * la fuerza, el modelo "haría trampa" viendo el futuro, y las métricas
 * saldrían artificialmente buenas (el error más común en backtesting, que
 * la propia literatura de WC2026 advierte: "cada feature usa solo
 * información disponible antes del pitido inicial").
 */
import { teamStrengthFromMatches, expectedGoals, poissonPrediction } from './poisson.js';
import { buildEloRatings, eloPrediction } from './elo.js';
import { formPrediction } from './form.js';
import { xgPrediction } from './xg.js';
import { fifaRankPrediction } from './fifaRank.js';
import { headToHeadPrediction } from './headToHead.js';
import { confederationShrinkagePrediction } from './confederationShrinkage.js';
import { ensemblePrediction, MODEL_IDS, DEFAULT_WEIGHTS } from './ensemble.js';
import { aggregateMetrics, actualOutcome, naiveBaselineMetrics } from './metrics.js';

/**
 * Reconstruye las predicciones de todos los modelos para UN partido,
 * usando exclusivamente partidos anteriores a su fecha (sin leakage).
 *
 * @param {Object} target - el partido a predecir
 * @param {Array} priorMatches - partidos jugados ANTES de target
 * @param {Array} allTeams - lista de equipos (para tla/conf/fifa)
 * @returns {Object} { poisson, elo, form, xg, fifa, confShrink, h2h, ensemble }
 */
function predictForMatch(target, priorMatches, allTeams) {
  const homeId = target.homeTeam?.id;
  const awayId = target.awayTeam?.id;
  if (homeId == null || awayId == null) return null;

  const homeTeam = allTeams.find(t => t.id === homeId);
  const awayTeam = allTeams.find(t => t.id === awayId);

  // Partidos previos de cada equipo (para fuerza individual)
  const homeMatches = priorMatches.filter(m => m.homeTeam?.id === homeId || m.awayTeam?.id === homeId);
  const awayMatches = priorMatches.filter(m => m.homeTeam?.id === awayId || m.awayTeam?.id === awayId);

  // ELO construido solo con partidos previos
  const eloR = buildEloRatings(priorMatches);

  const models = {};
  models.elo = eloPrediction(homeId, awayId, eloR);

  const homeStr = teamStrengthFromMatches(homeMatches, homeId, eloR);
  const awayStr = teamStrengthFromMatches(awayMatches, awayId, eloR);
  const { lambdaHome, lambdaAway } = expectedGoals(homeStr, awayStr);
  models.poisson = poissonPrediction(lambdaHome, lambdaAway);

  models.form = formPrediction(homeMatches, awayMatches, homeId, awayId, eloR);
  models.xg = xgPrediction(homeMatches, awayMatches, homeId, awayId, eloR);

  if (homeTeam?.tla && awayTeam?.tla) {
    models.fifa = fifaRankPrediction(homeTeam.tla, awayTeam.tla);
  }
  if (homeTeam && awayTeam) {
    models.confShrink = confederationShrinkagePrediction(
      homeTeam, awayTeam, homeStr.matchCount ?? 0, awayStr.matchCount ?? 0, eloR, allTeams
    );
  }
  models.h2h = headToHeadPrediction(priorMatches, homeId, awayId);

  // Nota: el modelo "market" no se puede backtestear (no tenemos cuotas
  // históricas archivadas), así que queda fuera de la evaluación.
  models.ensemble = ensemblePrediction(models, DEFAULT_WEIGHTS, 8000);

  return models;
}

/**
 * Ejecuta el backtest sobre un conjunto de partidos finalizados.
 *
 * Estrategia walk-forward: ordena los partidos cronológicamente y para cada
 * uno usa todos los anteriores como historial. Se descartan los primeros
 * `warmup` partidos (no hay suficiente historial para un pronóstico justo).
 *
 * @param {Array} matches - partidos finalizados (con marcador)
 * @param {Array} allTeams - lista de equipos
 * @param {Object} opts - { warmup, onProgress }
 * @returns {Object} métricas por modelo + baseline + conteo
 */
export async function runBacktest(matches, allTeams, opts = {}) {
  const { warmup = 30, onProgress = null } = opts;

  // Solo partidos finalizados con marcador y fecha, ordenados por fecha
  const finished = matches
    .filter(m => actualOutcome(m) != null && m.utcDate)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  if (finished.length <= warmup + 5) {
    return {
      error: `Datos insuficientes: se necesitan al menos ${warmup + 6} partidos finalizados, hay ${finished.length}. Precarga más equipos en Configuración.`,
      n: finished.length,
    };
  }

  // Acumuladores de {pred, actual} por modelo
  const evalsByModel = {};
  [...MODEL_IDS.filter(id => id !== 'market'), 'ensemble'].forEach(id => { evalsByModel[id] = []; });

  const testMatches = finished.slice(warmup);
  for (let i = 0; i < testMatches.length; i++) {
    const target = testMatches[i];
    const targetDate = new Date(target.utcDate);

    // Historial = todos los partidos ANTERIORES a la fecha del target (sin leakage).
    // Doble protección: (1) fecha estrictamente anterior, (2) excluir el target
    // por id explícitamente — por si un partido del mismo día-hora (o un id
    // duplicado por dedupe imperfecto) se colara y el modelo se viera a sí mismo.
    const priorMatches = finished.filter(m =>
      new Date(m.utcDate) < targetDate && m.id !== target.id
    );

    const preds = predictForMatch(target, priorMatches, allTeams);
    if (!preds) continue;

    const actual = actualOutcome(target);
    Object.keys(evalsByModel).forEach(id => {
      if (preds[id] != null) {
        evalsByModel[id].push({ pred: preds[id], actual });
      }
    });

    // Ceder el hilo periódicamente para no congelar la UI + reportar progreso
    if (onProgress && i % 5 === 0) {
      onProgress({ current: i + 1, total: testMatches.length });
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Agregar métricas por modelo
  const results = {};
  Object.keys(evalsByModel).forEach(id => {
    results[id] = aggregateMetrics(evalsByModel[id]);
  });

  return {
    perModel: results,
    baseline: naiveBaselineMetrics(testMatches),
    testCount: testMatches.length,
    warmup,
    totalAvailable: finished.length,
  };
}

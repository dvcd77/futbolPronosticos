/**
 * metrics.js — Métricas para evaluar pronósticos probabilísticos
 *
 * El problema que resuelve: hasta ahora no había forma de medir si un cambio
 * al modelo MEJORA o EMPEORA las predicciones. "Accuracy" simple (¿acertó el
 * resultado?) es insuficiente para salidas probabilísticas porque ignora la
 * CONFIANZA y el ORDEN de los resultados.
 *
 * La métrica principal es el RPS (Ranked Probability Score), estándar en la
 * literatura de forecasting futbolístico (usado en el Soccer Prediction
 * Challenge 2017). A diferencia de accuracy, el RPS es sensible a la
 * distancia entre resultados: en fútbol un empate está "más cerca" de una
 * victoria local que de una visitante, así que un pronóstico que falla por
 * poco se penaliza menos que uno que falla por mucho. Menor RPS = mejor.
 *
 * Referencias: Epstein (1969); Constantinou & Fenton (2012); Soccer
 * Prediction Challenge 2017.
 */

/**
 * Ranked Probability Score para un solo partido (3 resultados: 1, X, 2).
 *
 * Fórmula: RPS = 1/(r-1) · Σ_{i=1}^{r-1} ( Σ_{j=1}^{i} (p_j - a_j) )²
 * donde r = 3 resultados, p = probabilidades pronosticadas (acumuladas),
 * a = vector real one-hot del resultado observado.
 *
 * @param {Object} pred - { home, draw, away } probabilidades (suman ~1)
 * @param {'home'|'draw'|'away'} actual - resultado real observado
 * @returns {number} RPS en [0, 1], menor es mejor
 */
export function rankedProbabilityScore(pred, actual) {
  // Orden fijo: [home, draw, away] — importa porque el RPS es ordinal
  const p = [pred.home ?? 0, pred.draw ?? 0, pred.away ?? 0];
  const a = [
    actual === 'home' ? 1 : 0,
    actual === 'draw' ? 1 : 0,
    actual === 'away' ? 1 : 0,
  ];

  const r = 3;
  let cumP = 0, cumA = 0, sum = 0;
  for (let i = 0; i < r - 1; i++) {
    cumP += p[i];
    cumA += a[i];
    sum += (cumP - cumA) ** 2;
  }
  return sum / (r - 1);
}

/**
 * Brier score multiclase (suma de cuadrados de error sobre los 3 resultados).
 * No es sensible al orden (a diferencia del RPS), pero es un complemento útil.
 * Menor es mejor, rango [0, 2].
 */
export function brierScore(pred, actual) {
  const p = [pred.home ?? 0, pred.draw ?? 0, pred.away ?? 0];
  const a = [
    actual === 'home' ? 1 : 0,
    actual === 'draw' ? 1 : 0,
    actual === 'away' ? 1 : 0,
  ];
  return p.reduce((s, pi, i) => s + (pi - a[i]) ** 2, 0);
}

/**
 * Log loss (ignorance score) — penaliza fuertemente la sobreconfianza.
 * Si el modelo asignó probabilidad ~0 al resultado que ocurrió, explota.
 * Menor es mejor. Se aplica un epsilon para evitar log(0).
 */
export function logLoss(pred, actual) {
  const EPS = 1e-15;
  const pActual = clampProb(
    actual === 'home' ? pred.home : actual === 'draw' ? pred.draw : pred.away,
    EPS
  );
  return -Math.log(pActual);
}

function clampProb(p, eps) {
  return Math.min(Math.max(p ?? eps, eps), 1 - eps);
}

/**
 * Determina el resultado real de un partido a partir del marcador.
 * @returns {'home'|'draw'|'away'|null}
 */
export function actualOutcome(match) {
  const h = match.score?.fullTime?.home;
  const a = match.score?.fullTime?.away;
  if (h == null || a == null) return null;
  if (h > a) return 'home';
  if (h < a) return 'away';
  return 'draw';
}

/**
 * ¿El resultado más probable del pronóstico coincide con el real?
 * (accuracy clásica — útil pero insuficiente por sí sola)
 */
export function isTopPickCorrect(pred, actual) {
  const entries = [['home', pred.home ?? 0], ['draw', pred.draw ?? 0], ['away', pred.away ?? 0]];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0] === actual;
}

/**
 * Agrega métricas sobre una lista de pronósticos evaluados.
 * @param {Array<{pred, actual}>} evaluations
 * @returns {{ rps, brier, logLoss, accuracy, n }}
 */
export function aggregateMetrics(evaluations) {
  const valid = evaluations.filter(e => e.actual != null && e.pred != null);
  const n = valid.length;
  if (n === 0) return { rps: null, brier: null, logLoss: null, accuracy: null, n: 0 };

  let sumRps = 0, sumBrier = 0, sumLogLoss = 0, correct = 0;
  valid.forEach(({ pred, actual }) => {
    sumRps += rankedProbabilityScore(pred, actual);
    sumBrier += brierScore(pred, actual);
    sumLogLoss += logLoss(pred, actual);
    if (isTopPickCorrect(pred, actual)) correct++;
  });

  return {
    rps: sumRps / n,
    brier: sumBrier / n,
    logLoss: sumLogLoss / n,
    accuracy: correct / n,
    n,
  };
}

/**
 * Benchmark de referencia: el pronóstico "ingenuo" que siempre predice las
 * tasas base del fútbol internacional (~40% local, ~27% empate, ~33% visita).
 * Cualquier modelo útil debe tener RPS MENOR que este. Es el listón mínimo.
 */
export const NAIVE_BASELINE = { home: 0.40, draw: 0.27, away: 0.33 };

/**
 * RPS de referencia del baseline ingenuo sobre un conjunto de partidos.
 */
export function naiveBaselineMetrics(matches) {
  const evals = matches
    .map(m => ({ pred: NAIVE_BASELINE, actual: actualOutcome(m) }))
    .filter(e => e.actual != null);
  return aggregateMetrics(evals);
}

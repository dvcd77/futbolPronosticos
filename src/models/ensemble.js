import { mean } from './utils.js';
import { runMonteCarlo } from './monteCarlo.js';

// Modelos "siempre disponibles" (no dependen de condiciones externas) +
// modelos "condicionales" (solo votan cuando hay datos suficientes: h2h
// requiere enfrentamientos previos, market requiere mercado de cuotas abierto).
export const MODEL_IDS = ['poisson', 'elo', 'form', 'xg', 'fifa', 'confShrink', 'h2h', 'market'];

export const MODEL_LABELS = {
  poisson:    'Poisson',
  elo:        'ELO',
  form:       'Forma',
  xg:         'xG Aprox',
  fifa:       'Ranking FIFA',
  confShrink: 'Shrinkage Conf.',
  h2h:        'Head-to-Head',
  market:     'Mercado',
  ensemble:   'Ensemble',
};

// Pesos por defecto. h2h y market frecuentemente NO estarán disponibles para
// un partido dado (sin enfrentamientos previos / sin mercado abierto aún) —
// el ensemble renormaliza automáticamente entre los modelos presentes, así
// que estos pesos reflejan la importancia RELATIVA cuando todo está disponible.
// market recibe el mayor peso individual porque es la única señal que
// incorpora información que ningún modelo casero puede ver (lesiones,
// alineaciones, dinero informado) — en la práctica de modelos predictivos
// deportivos, el mercado suele superar a modelos estadísticos aislados.
export const DEFAULT_WEIGHTS = {
  poisson:    0.16,
  elo:        0.12,
  form:       0.16,
  xg:         0.12,
  fifa:       0.14,
  confShrink: 0.08,
  h2h:        0.07,
  market:     0.15,
};

/**
 * Combines predictions from multiple models using configurable weights.
 * Operates on lambdas (expected goals) for a richer combination.
 *
 * @param {Object} modelPredictions - solo modelos con predicción real (no null)
 * @param {Object} weights          - { poisson: 0.16, elo: 0.12, ... }
 * @param {number} simCount         - Monte Carlo simulation count
 */
export function ensemblePrediction(modelPredictions, weights = DEFAULT_WEIGHTS, simCount = 20000) {
  const availableModels = MODEL_IDS.filter(id => modelPredictions[id] != null);
  if (availableModels.length === 0) return null;

  // Normalize weights to the models that are actually present
  const totalW = availableModels.reduce((s, id) => s + (weights[id] ?? 0), 0);
  if (totalW <= 0) {
    // All weights are zero: fall back to equal weighting
    const eq = 1 / availableModels.length;
    availableModels.forEach(id => { weights = { ...weights, [id]: eq }; });
  }
  const normTotal = availableModels.reduce((s, id) => s + (weights[id] ?? 0), 0);
  const normW = {};
  availableModels.forEach(id => { normW[id] = (weights[id] ?? 0) / normTotal; });

  // Weighted mean of expected goals
  const lambdaHome = availableModels.reduce((s, id) =>
    s + (modelPredictions[id].lambdaHome ?? 1.30) * normW[id], 0);
  const lambdaAway = availableModels.reduce((s, id) =>
    s + (modelPredictions[id].lambdaAway ?? 1.30) * normW[id], 0);

  // Run Monte Carlo on the ensemble expected goals
  const mcResult = runMonteCarlo(lambdaHome, lambdaAway, simCount);

  return {
    ...mcResult,
    lambdaHome,
    lambdaAway,
    weightsUsed: normW,
    modelsIncluded: availableModels,
  };
}

/**
 * Summarize comparison table across all models.
 */
export function buildComparisonTable(modelPredictions) {
  return MODEL_IDS
    .filter(id => modelPredictions[id])
    .map(id => {
      const p = modelPredictions[id];
      return {
        model: id,
        label: MODEL_LABELS[id],
        home: p.home,
        draw: p.draw,
        away: p.away,
        lambdaHome: p.lambdaHome,
        lambdaAway: p.lambdaAway,
        over25: p.over?.['2.5'] ?? null,
        btts: p.btts ?? null,
      };
    });
}

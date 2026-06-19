import { mean } from './utils.js';
import { runMonteCarlo } from './monteCarlo.js';

export const MODEL_IDS = ['poisson', 'elo', 'form', 'xg', 'ml', 'fifa'];
export const MODEL_LABELS = {
  poisson: 'Poisson',
  elo:     'ELO',
  form:    'Forma',
  xg:      'xG Aprox',
  ml:      'ML Ligero',
  fifa:    'Ranking FIFA',
  ensemble:'Ensemble',
};

// Pesos rebalanceados para incluir Ranking FIFA. Este modelo no depende de
// qué competencias cubre la API de partidos (FIFA computa su ranking con
// TODOS los partidos oficiales, incluyendo AFCON, Copa América, Gold Cup),
// así que actúa como contrapeso cuando el historial de partidos es escaso.
export const DEFAULT_WEIGHTS = {
  poisson: 0.20,
  elo:     0.15,
  form:    0.20,
  xg:      0.15,
  ml:      0.10,
  fifa:    0.20,
};

/**
 * Combines predictions from multiple models using configurable weights.
 * Operates on lambdas (expected goals) for a richer combination.
 *
 * @param {Object} modelPredictions - only models with real (non-aliased) predictions
 * @param {Object} weights          - { poisson: 0.25, elo: 0.20, ... }
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

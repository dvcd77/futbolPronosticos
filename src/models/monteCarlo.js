import { poissonRandom, mean, stdDev } from './utils.js';

const MAX_GOALS_TRACK = 9;

/**
 * Run a single batch of Monte Carlo simulations.
 * Returns raw result counters.
 */
function runBatch(lambdaHome, lambdaAway, n) {
  let home = 0, draw = 0, away = 0;
  let over15 = 0, over25 = 0, over35 = 0;
  let btts = 0;
  let htHome = 0, htDraw = 0, htAway = 0;
  const scoreCounts = {};

  // HT lambda (42% of FT expected goals)
  const htLH = lambdaHome * 0.42;
  const htLA = lambdaAway * 0.42;

  for (let i = 0; i < n; i++) {
    const hg = poissonRandom(lambdaHome);
    const ag = poissonRandom(lambdaAway);

    if (hg > ag) home++;
    else if (hg === ag) draw++;
    else away++;

    const total = hg + ag;
    if (total > 1.5) over15++;
    if (total > 2.5) over25++;
    if (total > 3.5) over35++;
    if (hg > 0 && ag > 0) btts++;

    const key = `${Math.min(hg, MAX_GOALS_TRACK)}-${Math.min(ag, MAX_GOALS_TRACK)}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;

    // Half-time simulation
    const htHg = poissonRandom(htLH);
    const htAg = poissonRandom(htLA);
    if (htHg > htAg) htHome++;
    else if (htHg === htAg) htDraw++;
    else htAway++;
  }

  return { home, draw, away, over15, over25, over35, btts, htHome, htDraw, htAway, scoreCounts, n };
}

/**
 * Run Monte Carlo simulation in NUM_BATCHES batches.
 * Uses batch variance to compute standard deviations.
 *
 * @param {number} lambdaHome - Expected goals for home team
 * @param {number} lambdaAway - Expected goals for away team
 * @param {number} totalSims - Total simulations (10K–50K)
 * @param {number} numBatches - Number of batches for std dev (default 10)
 * @returns Full probability distribution with standard deviations
 */
export function runMonteCarlo(lambdaHome, lambdaAway, totalSims = 20000, numBatches = 10) {
  const batchSize = Math.max(100, Math.floor(totalSims / numBatches));
  const actualTotal = batchSize * numBatches;

  const batches = Array.from({ length: numBatches }, () => runBatch(lambdaHome, lambdaAway, batchSize));

  // Extract rates per batch for std dev calculation
  const rates = key => batches.map(b => b[key] / batchSize);

  const homeRates  = rates('home');
  const drawRates  = rates('draw');
  const awayRates  = rates('away');
  const o15Rates   = rates('over15');
  const o25Rates   = rates('over25');
  const o35Rates   = rates('over35');
  const bttsRates  = rates('btts');
  const htHRates   = rates('htHome');
  const htDRates   = rates('htDraw');
  const htARates   = rates('htAway');

  // Aggregate scores across all batches
  const allScores = {};
  batches.forEach(b => {
    for (const [k, v] of Object.entries(b.scoreCounts)) {
      allScores[k] = (allScores[k] || 0) + v;
    }
  });
  const normScores = {};
  for (const [k, v] of Object.entries(allScores)) normScores[k] = v / actualTotal;

  const fmt = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
  const fmtStd = v => Math.round(v * 1000) / 1000;

  return {
    totalSims: actualTotal,
    lambdaHome,
    lambdaAway,

    home:  fmt(mean(homeRates)),
    draw:  fmt(mean(drawRates)),
    away:  fmt(mean(awayRates)),
    stdDev: {
      home: fmtStd(stdDev(homeRates)),
      draw: fmtStd(stdDev(drawRates)),
      away: fmtStd(stdDev(awayRates)),
    },

    scores: normScores,

    over: {
      1.5: fmt(mean(o15Rates)),
      2.5: fmt(mean(o25Rates)),
      3.5: fmt(mean(o35Rates)),
    },
    under: {
      1.5: fmt(1 - mean(o15Rates)),
      2.5: fmt(1 - mean(o25Rates)),
      3.5: fmt(1 - mean(o35Rates)),
    },
    overStd: {
      1.5: fmtStd(stdDev(o15Rates)),
      2.5: fmtStd(stdDev(o25Rates)),
      3.5: fmtStd(stdDev(o35Rates)),
    },

    btts: fmt(mean(bttsRates)),
    bttsStd: fmtStd(stdDev(bttsRates)),

    halfTime: {
      home: fmt(mean(htHRates)),
      draw: fmt(mean(htDRates)),
      away: fmt(mean(htARates)),
    },
    halfTimeStd: {
      home: fmtStd(stdDev(htHRates)),
      draw: fmtStd(stdDev(htDRates)),
      away: fmtStd(stdDev(htARates)),
    },
  };
}

// Statistical utilities shared across all models

const factCache = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
export function factorial(n) {
  if (n < 0 || n > 170) return n < 0 ? NaN : Infinity;
  if (factCache[n] !== undefined) return factCache[n];
  factCache[n] = n * factorial(n - 1);
  return factCache[n];
}

// P(X=k) for Poisson distribution
export function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  // Use log for numerical stability
  const logProb = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logProb);
}

function logFactorial(n) {
  if (n <= 1) return 0;
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}

// P(X <= k) for Poisson
export function poissonCdf(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}

// Random draw from Poisson distribution (Knuth algorithm)
export function poissonRandom(lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 50) {
    // Normal approximation for large lambda
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * boxMullerRandom()));
  }
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// Box-Muller transform → standard normal random
export function boxMullerRandom() {
  const u = Math.random() || 1e-10;
  const v = Math.random() || 1e-10;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Dixon-Coles correction for low-scoring match bias
export function dixonColes(h, a, lambda, mu, rho = -0.10) {
  if (h > 1 || a > 1) return 1;
  if (h === 0 && a === 0) return 1 - lambda * mu * rho;
  if (h === 0 && a === 1) return 1 + lambda * rho;
  if (h === 1 && a === 0) return 1 + mu * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

export function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Softmax normalization
export function softmax(arr) {
  const max = Math.max(...arr);
  const exps = arr.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / sum);
}

// Convert ELO difference to win probability
export function eloToWinProb(eloDiff) {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

// Normalize an array so it sums to 1
export function normalize(arr) {
  const sum = arr.reduce((a, b) => a + b, 0);
  return sum > 0 ? arr.map(x => x / sum) : arr.map(() => 1 / arr.length);
}

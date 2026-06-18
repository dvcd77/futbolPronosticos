import { poissonRandom, mean, stdDev } from './utils.js';

// International football empirical constants
const SHOTS_PER_GOAL      = 10.2;  // total shots per goal scored
const SOT_PER_GOAL        = 4.1;   // shots on target per goal scored
const BASE_SHOTS_TEAM     = 10.5;  // shots per team per match baseline
const BASE_SOT_TEAM       = 4.0;   // shots on target per team per match baseline

// Position multiplier for shots per goal
const POSITION_MULT = {
  FW:  5.5,   // forwards shoot most efficiently
  AM:  8.0,   // attacking midfielders
  MF:  11.0,  // midfielders
  DF:  18.0,  // defenders
  GK:  999,   // goalkeepers (rarely)
};

/**
 * Estimate team-level shots from expected goals.
 * Returns expected total shots and shots on target per team.
 */
export function teamShotsPrediction(lambdaHome, lambdaAway, simCount = 10000) {
  const homeShotsExp = lambdaHome * SHOTS_PER_GOAL;
  const awayShotsExp = lambdaAway * SHOTS_PER_GOAL;
  const homeSOTExp   = lambdaHome * SOT_PER_GOAL;
  const awaySOTExp   = lambdaAway * SOT_PER_GOAL;

  // Monte Carlo for shot distributions
  const homeShots = [], awayShots = [], homeSOT = [], awaySOT = [];
  for (let i = 0; i < simCount; i++) {
    // Goals → derive shots using Poisson draws for each component
    const hg = poissonRandom(lambdaHome);
    const ag = poissonRandom(lambdaAway);
    // Extra randomness: some games have more shots than goals suggest
    const hNoise = poissonRandom(1.8);
    const aNoise = poissonRandom(1.8);

    const hShots = Math.max(1, hg * SHOTS_PER_GOAL + hNoise - 0.9);
    const aShots = Math.max(1, ag * SHOTS_PER_GOAL + aNoise - 0.9);
    const hSOT   = Math.max(0, Math.min(hShots, hg * SOT_PER_GOAL + poissonRandom(0.8)));
    const aSOT   = Math.max(0, Math.min(aShots, ag * SOT_PER_GOAL + poissonRandom(0.8)));

    homeShots.push(Math.round(hShots));
    awayShots.push(Math.round(aShots));
    homeSOT.push(Math.round(hSOT));
    awaySOT.push(Math.round(aSOT));
  }

  const fmt = v => Math.round(v * 10) / 10;
  const fmtStd = v => Math.round(v * 10) / 10;

  return {
    home: {
      shots:    { mean: fmt(mean(homeShots)),  std: fmtStd(stdDev(homeShots)),  expected: fmt(homeShotsExp) },
      shotsOnTarget: { mean: fmt(mean(homeSOT)), std: fmtStd(stdDev(homeSOT)), expected: fmt(homeSOTExp) },
    },
    away: {
      shots:    { mean: fmt(mean(awayShots)),  std: fmtStd(stdDev(awayShots)),  expected: fmt(awayShotsExp) },
      shotsOnTarget: { mean: fmt(mean(awaySOT)), std: fmtStd(stdDev(awaySOT)), expected: fmt(awaySOTExp) },
    },
    histograms: {
      homeShots: buildHistogram(homeShots, 0, 30),
      awayShots: buildHistogram(awayShots, 0, 30),
    },
  };
}

/**
 * Estimate player-level shots given their recent scoring rate.
 * @param {Object} player - { id, name, goals, matchesPlayed, position }
 * @param {number} teamLambda - Team's expected goals in the match
 * @param {number} teamGoalRate - Team's average goals per match
 */
export function playerShotsPrediction(player, teamLambda, teamGoalRate, simCount = 10000) {
  const { goals = 1, matchesPlayed = 5, position = 'MF' } = player;
  const playerGoalRate = goals / Math.max(matchesPlayed, 1);

  // Player's share of team goals
  const share = teamGoalRate > 0 ? Math.min(playerGoalRate / teamGoalRate, 0.6) : 0.15;

  // Expected goals and shots for this player in the match
  const playerLambda = teamLambda * share;
  const positionMult = POSITION_MULT[position] ?? 10;
  const playerShotsExp = playerLambda * positionMult;
  const playerSOTExp   = playerLambda * Math.min(positionMult * 0.42, SOT_PER_GOAL);

  const shots = [], sot = [];
  for (let i = 0; i < simCount; i++) {
    const pg = poissonRandom(playerLambda);
    const noise = poissonRandom(0.6);
    const s = Math.max(0, pg * positionMult + noise - 0.3);
    const so = Math.max(0, Math.min(s, pg * positionMult * 0.42 + poissonRandom(0.3)));
    shots.push(Math.round(s));
    sot.push(Math.round(so));
  }

  const fmt = v => Math.round(v * 10) / 10;
  return {
    playerName: player.name,
    position,
    shots:    { mean: fmt(mean(shots)),  std: fmt(stdDev(shots)),  expected: fmt(playerShotsExp) },
    shotsOnTarget: { mean: fmt(mean(sot)), std: fmt(stdDev(sot)), expected: fmt(playerSOTExp) },
    goalShare: Math.round(share * 100),
    playerLambda: fmt(playerLambda),
  };
}

function buildHistogram(data, min, max) {
  const bins = {};
  data.forEach(v => {
    const b = Math.min(Math.max(Math.round(v), min), max);
    bins[b] = (bins[b] || 0) + 1;
  });
  const total = data.length;
  return Object.entries(bins)
    .map(([k, v]) => ({ value: +k, count: v, prob: v / total }))
    .sort((a, b) => a.value - b.value);
}

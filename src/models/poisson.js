import { poissonPmf, poissonCdf, dixonColes, clamp } from './utils.js';
import { eloStrengthFactor } from './elo.js';

const BASE_LAMBDA = 1.30;
const MAX_GOALS   = 9;
const DC_RHO      = -0.10;

/**
 * Compute attack/defense strength from match history.
 * Falls back to ELO-based estimate when no matches are available,
 * so the model gives meaningful (non-identical) output without history.
 */
export function teamStrengthFromMatches(matches, teamId, eloRatings = null) {
  const valid = matches.filter(m =>
    m.score?.fullTime?.home != null && m.score?.fullTime?.away != null &&
    m.status === 'FINISHED'
  );

  if (valid.length === 0) {
    // ELO fallback: above-average teams attack more and concede less.
    //
    // BUG CORREGIDO: antes se devolvía attack=f, defense=1/f. Pero como el λ
    // se calcula como BASE * ataque_local * defensa_rival, y AMBOS factores
    // codifican la misma diferencia de nivel, el factor ELO terminaba
    // aplicándose AL CUADRADO — produciendo λ absurdamente altos (5.46 goles
    // en casos extremos, marcadores tipo 6-0 como resultado más probable).
    //
    // Solución: usar sqrt(f). Así, cuando un equipo fuerte (ataque √f) enfrenta
    // a uno débil (defensa √f del débil = 1/√f_débil), el producto refleja la
    // diferencia de nivel UNA sola vez, no al cuadrado. Esto mantiene los λ en
    // el rango realista del fútbol internacional (~0.4 a ~3.2).
    const f = eloStrengthFactor(teamId, eloRatings);
    const sq = Math.sqrt(f);
    return { attack: sq, defense: 1 / sq, fromElo: true };
  }

  let wScored = 0, wConceded = 0, wTotal = 0;
  valid.slice(-30).forEach((m, i, arr) => {
    const w = Math.pow(0.92, arr.length - 1 - i);
    const isHome = m.homeTeam?.id === teamId;
    wScored   += (isHome ? m.score.fullTime.home : m.score.fullTime.away) * w;
    wConceded += (isHome ? m.score.fullTime.away : m.score.fullTime.home) * w;
    wTotal    += w;
  });

  // Fuerzas crudas: ratio del rendimiento del equipo vs la media del fútbol.
  const rawAttack  = (wScored   / wTotal) / BASE_LAMBDA;
  const rawDefense = (wConceded / wTotal) / BASE_LAMBDA;

  // SHRINKAGE (regularización): los modelos Poisson sin regularizar son
  // notoriamente SOBRECONFIADOS — multiplican ataque_local × defensa_rival sin
  // atenuar, amplificando las diferencias y dando probabilidades extremas
  // (p.ej. 81% al favorito cuando Form/xG/ELO dan 61-67%). Para corregirlo,
  // encogemos cada fuerza hacia 1.0 (la media) con un factor SHRINK. Esto
  // refleja que el rendimiento pasado es una señal RUIDOSA del nivel real:
  // un equipo que marcó 2.5/partido probablemente es bueno, pero no TAN bueno
  // como sugiere el dato crudo (regresión a la media). SHRINK=0.60 calibra la
  // confianza de Poisson para que quede alineada con Form (~61%) y xG (~62%)
  // en el mismo partido, en vez del 81% sobreconfiado de antes.
  const SHRINK = 0.60;
  const attack  = 1 + SHRINK * (rawAttack  - 1);
  const defense = 1 + SHRINK * (rawDefense - 1);

  return {
    attack:  clamp(attack,  0.35, 3.0),
    defense: clamp(defense, 0.35, 3.0),
    fromElo: false,
    matchCount: valid.length,
  };
}

export function expectedGoals(homeStr, awayStr) {
  return {
    lambdaHome: clamp(BASE_LAMBDA * homeStr.attack * awayStr.defense, 0.20, 6.0),
    lambdaAway: clamp(BASE_LAMBDA * awayStr.attack * homeStr.defense, 0.20, 6.0),
  };
}

export function poissonPrediction(lambdaHome, lambdaAway) {
  let home = 0, draw = 0, away = 0;
  const scores = {};
  let scoreSum = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const raw = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      const dc  = dixonColes(h, a, lambdaHome, lambdaAway, DC_RHO);
      const p   = Math.max(0, raw * dc);
      scores[`${h}-${a}`] = p;
      scoreSum += p;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }

  const tot = home + draw + away;
  const normalScores = {};
  for (const [k, v] of Object.entries(scores)) normalScores[k] = v / scoreSum;

  const totalLambda = lambdaHome + lambdaAway;
  const over15 = 1 - poissonCdf(1, totalLambda);
  const over25 = 1 - poissonCdf(2, totalLambda);
  const over35 = 1 - poissonCdf(3, totalLambda);
  const btts   = (1 - poissonPmf(0, lambdaHome)) * (1 - poissonPmf(0, lambdaAway));

  const htLH = lambdaHome * 0.42;
  const htLA = lambdaAway * 0.42;
  let htHome = 0, htDraw = 0, htAway = 0;
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = poissonPmf(h, htLH) * poissonPmf(a, htLA);
      if (h > a) htHome += p;
      else if (h === a) htDraw += p;
      else htAway += p;
    }
  }
  const htTot = htHome + htDraw + htAway || 1;

  return {
    home: home / tot,
    draw: draw / tot,
    away: away / tot,
    scores: normalScores,
    over:  { 1.5: over15, 2.5: over25, 3.5: over35 },
    under: { 1.5: 1-over15, 2.5: 1-over25, 3.5: 1-over35 },
    btts,
    halfTime: { home: htHome/htTot, draw: htDraw/htTot, away: htAway/htTot },
    lambdaHome,
    lambdaAway,
  };
}

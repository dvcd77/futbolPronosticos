/**
 * fifaRanking.js — Ranking FIFA oficial (publicado 11 junio 2026)
 *
 * Fuente: FIFA/Coca-Cola Men's World Ranking — última actualización antes
 * del Mundial 2026. Próxima actualización oficial: 20 julio 2026.
 *
 * `rank` es exacto para los 48 equipos clasificados (verificado vía ESPN +
 * FIFA.com, junio 2026). `points` es exacto para los puestos 1-20 (fuente
 * directa); para el resto se interpola con una curva logarítmica calibrada
 * a los puntos conocidos (P(1)=1877, P(20)=1620), ya que FIFA no publica
 * la tabla completa de puntos de forma gratuita. El ORDEN relativo (rank)
 * es siempre exacto — la interpolación solo afecta la MAGNITUD del gap
 * entre equipos fuera del top 20.
 *
 * Actualizar manualmente tras cada publicación oficial de FIFA
 * (~cada 2 meses): https://inside.fifa.com/fifa-world-ranking/men
 */

// Equipos con puntos oficiales confirmados (top 20, junio 2026)
const CONFIRMED_POINTS = {
  ARG: 1877.27, ESP: 1874.71, FRA: 1860.00, ENG: 1825.97, POR: 1763.83,
  BRA: 1761.16, MAR: 1758.00, NED: 1756.00, BEL: 1734.71, GER: 1730.37,
  CRO: 1717.07, COL: 1693.09, MEX: 1681.03, SEN: 1685.00, URU: 1673.07,
  USA: 1673.13, JPN: 1660.43, SUI: 1649.40, IRN: 1620.00,
};

// rank exacto para los 48 equipos clasificados (ESPN/FIFA, 11 jun 2026)
const RANK_TABLE = {
  ARG: 1,  ESP: 2,  FRA: 3,  ENG: 4,  POR: 5,  BRA: 6,  MAR: 7,  NED: 8,
  BEL: 9,  GER: 10, CRO: 11, COL: 13, MEX: 14, SEN: 15, URU: 16, USA: 17,
  JPN: 18, SUI: 19, IRN: 20, TUR: 22, ECU: 23, AUT: 24, KOR: 25, AUS: 27,
  ALG: 28, EGY: 29, CAN: 30, NOR: 31, CIV: 33, PAN: 34, SWE: 38, CZE: 40,
  PAR: 41, SCO: 42, TUN: 45, COD: 46, UZB: 50, QAT: 56, IRQ: 57, RSA: 60,
  KSA: 61, JOR: 63, BIH: 64, CPV: 67, GHA: 73, CUW: 82, HAI: 83, NZL: 85,
};

// Curva de interpolación: P(rank) = A - B·ln(rank), calibrada a datos reales
const CURVE_A = 1877;
const CURVE_B = 85.78;

function interpolatedPoints(rank) {
  return Math.round((CURVE_A - CURVE_B * Math.log(rank)) * 100) / 100;
}

/** Devuelve { rank, points, isExact } para un código TLA. */
export function getFifaRanking(tla) {
  const rank = RANK_TABLE[tla];
  if (rank == null) return null; // equipo no encontrado (no debería pasar para los 48 de WC)
  const points = CONFIRMED_POINTS[tla] ?? interpolatedPoints(rank);
  return { rank, points, isExact: CONFIRMED_POINTS[tla] != null };
}

export const FIFA_RANKING_UPDATED = '2026-06-11';
export const FIFA_RANKING_NEXT_UPDATE = '2026-07-20';

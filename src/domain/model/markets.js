'use strict';

/**
 * Market probabilities derived from the score matrix (spec §10).
 * Over/Under is taken from the cumulative (under) side; BTTS uses the closed form.
 * @param {{ matrix: number[][] }} scores
 * @param {number} lambdaHome
 * @param {number} lambdaAway
 * @param {number[]} ouLines e.g. [1.5, 2.5, 3.5]
 */
function marketProbabilities({ matrix }, lambdaHome, lambdaAway, ouLines) {
  let pH = 0;
  let pD = 0;
  let pA = 0;
  const totals = [];
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      const p = matrix[h][a];
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
      totals[h + a] = (totals[h + a] || 0) + p;
    }
  }
  const ou = {};
  for (const line of ouLines) {
    let under = 0;
    for (let t = 0; t <= Math.floor(line); t += 1) under += totals[t] || 0;
    ou[line] = { OVER: 1 - under, UNDER: under };
  }
  const bttsYes = (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway));
  return {
    '1X2': { HOME: pH, DRAW: pD, AWAY: pA },
    DC: { '1X': pH + pD, 12: pH + pA, X2: pD + pA },
    // Draw No Bet: the draw is a push (stake returned).
    DNB: { HOME: { win: pH, push: pD, loss: pA }, AWAY: { win: pA, push: pD, loss: pH } },
    OU: ou,
    BTTS: { YES: bttsYes, NO: 1 - bttsYes },
  };
}

/** Fair odds: 1/p (spec §11); null below pFloor. */
function fairOdds(p, pFloor) {
  return p >= pFloor ? 1 / p : null;
}

/** DNB fair odds from EV = 0 with push = 0: 1 + p_loss / p_win. */
function fairOddsDnb({ win, loss }, pFloor) {
  return win >= pFloor ? 1 + loss / win : null;
}

module.exports = { marketProbabilities, fairOdds, fairOddsDnb };

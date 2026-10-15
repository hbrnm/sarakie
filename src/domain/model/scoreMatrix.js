'use strict';

const { poissonPmf, goalsCutoff } = require('./poisson');

/**
 * Independent Poisson score matrix P(h, a) = Pois(h; λH) · Pois(a; λA), h, a ∈ 0..G (spec §9).
 * Not renormalized: the truncated mass ε = 1 − ΣP is returned as a diagnostic.
 * @returns {{ matrix: number[][], g: number, epsilon: number } | null} null if G would exceed maxGoals
 */
function buildScoreMatrix(lambdaHome, lambdaAway, { tailTolerance, maxGoals }) {
  const gH = goalsCutoff(lambdaHome, tailTolerance, maxGoals);
  const gA = goalsCutoff(lambdaAway, tailTolerance, maxGoals);
  if (gH === null || gA === null) return null;
  const g = Math.max(gH, gA);
  const ph = poissonPmf(lambdaHome, g);
  const pa = poissonPmf(lambdaAway, g);
  const matrix = ph.map((x) => pa.map((y) => x * y));
  let total = 0;
  for (const row of matrix) for (const v of row) total += v;
  return { matrix, g, epsilon: 1 - total };
}

module.exports = { buildScoreMatrix };

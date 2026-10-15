'use strict';

/**
 * Poisson probabilities computed iteratively (p0 = e^-λ, p(x+1) = p(x)·λ/(x+1)):
 * no factorials, no overflow, deterministic floating-point order.
 */
function poissonPmf(lambda, maxX) {
  if (!(lambda > 0) || !Number.isFinite(lambda)) throw new RangeError(`invalid lambda: ${lambda}`);
  const out = new Array(maxX + 1);
  out[0] = Math.exp(-lambda);
  for (let x = 0; x < maxX; x += 1) out[x + 1] = (out[x] * lambda) / (x + 1);
  return out;
}

/** P(X > g), summed from the tail side to avoid 1 − (sum ≈ 1) cancellation. */
function poissonUpperTail(lambda, g, extra = 200) {
  const pmf = poissonPmf(lambda, g + extra);
  let tail = 0;
  for (let x = g + extra; x > g; x -= 1) tail += pmf[x];
  return tail;
}

/** Smallest g with P(X > g) < tolerance, or null when it exceeds maxGoals. */
function goalsCutoff(lambda, tolerance, maxGoals) {
  for (let g = 0; g <= maxGoals; g += 1) if (poissonUpperTail(lambda, g) < tolerance) return g;
  return null;
}

module.exports = { poissonPmf, poissonUpperTail, goalsCutoff };

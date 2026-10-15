'use strict';

const { isValidDecimalOdds } = require('../markets');

/**
 * Market-side probabilities and expected value (CLAUDE.md §6, spec §12).
 * Terms are kept distinct: raw implied, de-vigged market, model probability, fair odds, EV.
 */

function impliedProbability(odds) {
  if (!isValidDecimalOdds(odds)) throw new RangeError(`invalid decimal odds: ${odds}`);
  return 1 / odds;
}

/** Complete comparable outcome sets per market (same bookmaker, same snapshot). */
const COMPLETE_SETS = Object.freeze({
  '1X2': ['HOME', 'DRAW', 'AWAY'],
  OU: ['OVER', 'UNDER'],
  BTTS: ['YES', 'NO'],
  DNB: ['HOME', 'AWAY'], // partitions "no draw": de-vigged values are conditional on no draw
});

/**
 * Proportional de-vig of one complete set: p_fair_i = p_raw_i / Σ p_raw.
 * Double Chance is never normalized this way (its outcomes overlap).
 * @param {string} marketCode
 * @param {Record<string, number>} oddsBySelection
 * @returns {{ complete: true, pRaw: Record<string, number>, pFair: Record<string, number>, overround: number } | { complete: false, reason: string }}
 */
function devig(marketCode, oddsBySelection) {
  if (marketCode === 'DC') return { complete: false, reason: 'DC_NOT_NORMALIZABLE' };
  const set = COMPLETE_SETS[marketCode];
  if (!set) return { complete: false, reason: 'UNKNOWN_MARKET' };
  if (!set.every((s) => isValidDecimalOdds(oddsBySelection[s]))) return { complete: false, reason: 'MARKET_INCOMPLETE' };
  const pRaw = Object.fromEntries(set.map((s) => [s, 1 / oddsBySelection[s]]));
  const sum = set.reduce((acc, s) => acc + pRaw[s], 0);
  const pFair = Object.fromEntries(set.map((s) => [s, pRaw[s] / sum]));
  return { complete: true, pRaw, pFair, overround: sum - 1 };
}

const POWER_K_MIN = 1;
const POWER_K_MAX = 5;
const POWER_TOLERANCE = 1e-9;
const POWER_MAX_ITERATIONS = 100;

/**
 * Power-method de-vig of one complete set (line shopping rule ≥ 1.1.0, docs/23 §9):
 * find k > 0 with Σ p_raw_i^k = 1, then p_fair_i = p_raw_i^k. Unlike proportional
 * normalization it takes more margin from longshots than from favourites (favourite–longshot
 * bias). Deterministic bisection on k ∈ [1, 5]: stops when |Σ p_raw_i^k − 1| < 1e-9 or after
 * 100 iterations. Falls back to proportional normalization when there is no margin to remove
 * (Σ p_raw ≤ 1) or the root is not bracketed (degenerate input); `method` says which applied.
 * @param {string} marketCode
 * @param {Record<string, number>} oddsBySelection
 * @returns {{ complete: true, pRaw: Record<string, number>, pFair: Record<string, number>, overround: number, method: 'power'|'proportional', k: number|null } | { complete: false, reason: string }}
 */
function devigPower(marketCode, oddsBySelection) {
  const base = devig(marketCode, oddsBySelection);
  if (!base.complete) return base;
  const set = COMPLETE_SETS[marketCode];
  const r = set.map((s) => base.pRaw[s]);
  const excess = (k) => r.reduce((acc, x) => acc + x ** k, 0) - 1;
  if (!(base.overround > 0) || !(excess(POWER_K_MAX) < 0)) return { ...base, method: 'proportional', k: null };
  let lo = POWER_K_MIN;
  let hi = POWER_K_MAX;
  let k = (lo + hi) / 2;
  for (let i = 0; i < POWER_MAX_ITERATIONS; i += 1) {
    k = (lo + hi) / 2;
    const f = excess(k);
    if (Math.abs(f) < POWER_TOLERANCE) break;
    if (f > 0) lo = k; // Σ p^k decreases in k (every p_raw < 1)
    else hi = k;
  }
  const pFair = Object.fromEntries(set.map((s) => [s, base.pRaw[s] ** k]));
  return { complete: true, pRaw: base.pRaw, pFair, overround: base.overround, method: 'power', k };
}

/**
 * De-vig with a named method: 'proportional' (CLAUDE.md §6) or 'power' (see devigPower).
 * @param {'proportional'|'power'} method
 */
function devigWith(method, marketCode, oddsBySelection) {
  if (method === 'power') return devigPower(marketCode, oddsBySelection);
  if (method === 'proportional') {
    const d = devig(marketCode, oddsBySelection);
    return d.complete ? { ...d, method: 'proportional', k: null } : d;
  }
  throw new RangeError(`unknown de-vig method: ${method}`);
}

/** Double Chance market reference from the same bookmaker's de-vigged 1X2 (spec §12). */
function doubleChanceFrom1x2(pFair1x2) {
  const { HOME, DRAW, AWAY } = pFair1x2;
  return { '1X': HOME + DRAW, 12: HOME + AWAY, X2: DRAW + AWAY };
}

/** Model DNB probability conditional on no draw, comparable with a de-vigged DNB market. */
function dnbConditional({ win, loss }) {
  return win + loss > 0 ? win / (win + loss) : null;
}

/** EV per unit stake for a binary outcome: p · odds − 1. */
function expectedValue(p, odds) {
  if (!isValidDecimalOdds(odds)) throw new RangeError(`invalid decimal odds: ${odds}`);
  return p * odds - 1;
}

/** EV per unit stake for Draw No Bet: p_win · (odds − 1) − p_loss; a push contributes 0. */
function expectedValueDnb({ win, loss }, odds) {
  if (!isValidDecimalOdds(odds)) throw new RangeError(`invalid decimal odds: ${odds}`);
  return win * (odds - 1) - loss;
}

module.exports = { impliedProbability, devig, devigPower, devigWith, doubleChanceFrom1x2, dnbConditional, expectedValue, expectedValueDnb, COMPLETE_SETS };

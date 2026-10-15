'use strict';

/**
 * Paper settlement of a prediction against the final score (Phase 5.4).
 * Pure and deterministic. Notional stake of 1 unit, decimal odds (CLAUDE.md §6):
 *   WIN  → odds − 1,  LOSS → −1,  PUSH (DNB draw) → 0,  VOID → no profit.
 *
 * Rules:
 * - fixture CANCELLED or AWARDED → VOID (no sporting result to settle on);
 * - a prediction without a priced quote (INSUFFICIENT_DATA, no odds) → VOID: there is no
 *   paper position. Model calibration (Phase 6) joins predictions to fixtures directly;
 * - only FINISHED fixtures with a full-time score are settled by result; anything else is
 *   not settled yet (null), e.g. POSTPONED.
 *
 * @param {{ marketCode: string, selectionCode: string, line: number|null, decimalOdds: number|null }} prediction
 * @param {{ status: string, homeGoals: number|null, awayGoals: number|null }} fixture
 * @returns {{ result: 'WIN'|'LOSS'|'PUSH'|'VOID', profit: number|null } | null}
 */
function settlePrediction(prediction, fixture) {
  if (fixture.status === 'CANCELLED' || fixture.status === 'AWARDED') return { result: 'VOID', profit: null };
  if (fixture.status !== 'FINISHED' || !Number.isInteger(fixture.homeGoals) || !Number.isInteger(fixture.awayGoals)) return null;
  const odds = prediction.decimalOdds;
  if (!(typeof odds === 'number' && Number.isFinite(odds) && odds > 1)) return { result: 'VOID', profit: null };

  const h = fixture.homeGoals;
  const a = fixture.awayGoals;
  const { marketCode: m, selectionCode: s, line } = prediction;
  let won;
  switch (m) {
    case '1X2':
      won = { HOME: h > a, DRAW: h === a, AWAY: a > h }[s];
      break;
    case 'DC':
      won = { '1X': h >= a, 12: h !== a, X2: a >= h }[s];
      break;
    case 'DNB':
      if (h === a) return { result: 'PUSH', profit: 0 };
      won = s === 'HOME' ? h > a : a > h;
      break;
    case 'OU':
      if (!Number.isFinite(line) || Number.isInteger(line)) throw new RangeError(`unsupported O/U line: ${line}`); // only .5 lines are in scope
      won = s === 'OVER' ? h + a > line : h + a < line;
      break;
    case 'BTTS':
      won = s === 'YES' ? h > 0 && a > 0 : !(h > 0 && a > 0);
      break;
    default:
      throw new RangeError(`unknown market: ${m}`);
  }
  if (won === undefined) throw new RangeError(`unknown selection: ${m} ${s}`);
  return won ? { result: 'WIN', profit: odds - 1 } : { result: 'LOSS', profit: -1 };
}

module.exports = { settlePrediction };

'use strict';

const { settlePrediction } = require('../domain/settlement');

/**
 * Paper settlement (Phase 5.4): every prediction whose fixture is FINISHED, CANCELLED or
 * AWARDED and has no outcome gets one append-only `prediction_outcomes` row. Runs after the
 * daily results sync. Idempotent: settled predictions leave the view; a concurrent
 * duplicate insert is ignored. Closing odds stay null until a reliable source exists (Phase 6).
 *
 * @param {{ store: ReturnType<typeof import('../persistence/analysisStore').createAnalysisStore>, now?: () => Date }} deps
 */
async function settle({ store, now = () => new Date() }) {
  const pending = await store.unsettledPredictions();
  const settledAt = now().toISOString();
  const rows = [];
  const counts = { WIN: 0, LOSS: 0, PUSH: 0, VOID: 0 };
  let profit = 0;
  let priced = 0;
  for (const p of pending) {
    const r = settlePrediction(p, p.fixture);
    if (!r) continue;
    counts[r.result] += 1;
    if (r.profit !== null) {
      profit += r.profit;
      priced += 1;
    }
    rows.push({
      prediction_id: p.predictionId,
      settled_at: settledAt,
      result: r.result,
      home_goals: p.fixture.homeGoals,
      away_goals: p.fixture.awayGoals,
      closing_odds_snapshot_id: null,
      profit_per_unit: r.profit,
    });
  }
  await store.insertOutcomes(rows);
  return { pending: pending.length, settled: rows.length, counts, priced, paperProfit: profit };
}

module.exports = { settle };

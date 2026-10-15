'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { settle } = require('../../src/jobs/settle');

/** Minimal store double over in-memory rows (the view logic itself is tested in SQL). */
function fakeStore(pending) {
  const outcomes = [];
  return {
    outcomes,
    async unsettledPredictions() {
      return pending.filter((p) => !outcomes.some((o) => o.prediction_id === p.predictionId));
    },
    async insertOutcomes(rows) {
      for (const r of rows) if (!outcomes.some((o) => o.prediction_id === r.prediction_id)) outcomes.push(r);
    },
  };
}

const fx = (status, h, a) => ({ status, homeGoals: h, awayGoals: a });
const pred = (id, marketCode, selectionCode, line, decimalOdds, fixture) => ({ predictionId: id, marketCode, selectionCode, line, decimalOdds, fixture });

test('settles every final prediction once, with paper profit; postponed ones wait', async () => {
  const store = fakeStore([
    pred(1, '1X2', 'HOME', null, 2.0, fx('FINISHED', 2, 0)),
    pred(2, 'OU', 'OVER', 2.5, 1.9, fx('FINISHED', 2, 0)),
    pred(3, 'DNB', 'AWAY', null, 2.2, fx('FINISHED', 1, 1)),
    pred(4, 'BTTS', 'YES', null, null, fx('FINISHED', 1, 1)),
    pred(5, '1X2', 'DRAW', null, 3.4, fx('CANCELLED', null, null)),
    pred(6, '1X2', 'AWAY', null, 3.0, fx('POSTPONED', null, null)),
  ]);
  const t = new Date('2026-10-17T07:20:00Z');
  const r = await settle({ store, now: () => t });
  assert.deepEqual([r.pending, r.settled, r.counts], [6, 5, { WIN: 1, LOSS: 1, PUSH: 1, VOID: 2 }]);
  assert.equal(r.priced, 3);
  assert.ok(Math.abs(r.paperProfit - 0) < 1e-12); // +1.0 − 1 + 0
  const o = Object.fromEntries(store.outcomes.map((x) => [x.prediction_id, x]));
  assert.deepEqual([o[1].result, o[1].profit_per_unit, o[1].home_goals, o[1].settled_at], ['WIN', 1, 2, t.toISOString()]);
  assert.equal(o[4].profit_per_unit, null);
  assert.equal(o[6], undefined);

  const again = await settle({ store, now: () => t });
  assert.deepEqual([again.pending, again.settled], [1, 0]);
  assert.equal(store.outcomes.length, 5);
});

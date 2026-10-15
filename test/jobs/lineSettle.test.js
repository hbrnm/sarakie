'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lineSettle } = require('../../src/jobs/lineSettle');
const { createFakeDb } = require('../persistence/fakeDb');
const { createAnalysisStore } = require('../../src/persistence/analysisStore');
const { devig, devigPower } = require('../../src/domain/odds');

const NOW = new Date('2026-10-20T08:30:00Z');

/** Store double: the view itself is tested in SQL; closing odds go through the real store code. */
function setup(pending) {
  const fake = createFakeDb();
  fake.table('bookmakers').push({ id: 9, source_provider: 'football_data_co_uk', provider_bookmaker_key: 'pinnacle', name: 'Pinnacle' });
  const closing = (fixtureId, h, d, a, base) =>
    [['HOME', h], ['DRAW', d], ['AWAY', a]].forEach(([s, o], i) =>
      fake.table('odds_snapshots').push({ id: base + i, fixture_id: fixtureId, bookmaker_id: 9, market_code: '1X2', selection_code: s, decimal_odds: o, kind: 'closing' }));
  closing('f1', 1.9, 3.7, 4.3, 100);
  const store = createAnalysisStore(fake);
  const real = store.insertLineOutcomes;
  return {
    fake,
    store: {
      ...store,
      unsettledLineCandidates: async () => pending.filter((p) => !fake.table('line_candidate_outcomes').some((o) => o.candidate_id === p.candidateId)),
      insertLineOutcomes: real,
    },
  };
}

const fx = (status, h, a, kickoffUtc = '2026-10-18T13:30:00Z') => ({ status, homeGoals: h, awayGoals: a, kickoffUtc });
const cand = (candidateId, fixtureId, selectionCode, price, fixture) => ({ candidateId, fixtureId, selectionCode, price, fixture });

test('settles candidates with Pinnacle close; waits for missing closing odds, then settles without CLV', async () => {
  const pending = [
    cand(1, 'f1', 'HOME', 2.15, fx('FINISHED', 2, 1)),
    cand(2, 'f2', 'AWAY', 3.5, fx('FINISHED', 0, 1)), // no closing yet, 2 days after kickoff → wait
    cand(3, 'f3', 'DRAW', 3.4, fx('FINISHED', 1, 1, '2026-10-05T13:30:00Z')), // no closing after 15 days → settle
    cand(4, 'f4', 'HOME', 2.0, fx('CANCELLED', null, null)),
  ];
  const { fake, store } = setup(pending);
  const r = await lineSettle({ store, now: () => NOW });
  assert.deepEqual([r.pending, r.settled, r.withClosing, r.waitingForClosing, r.counts], [4, 3, 1, 1, { WIN: 2, LOSS: 0, VOID: 1 }]);
  const o = Object.fromEntries(fake.table('line_candidate_outcomes').map((x) => [x.candidate_id, x]));
  assert.equal(o[1].close_snapshot_id, 100);
  assert.equal(o[1].pin_close_odds, 1.9);
  assert.ok(Math.abs(o[1].clv - (2.15 / 1.9 - 1)) < 1e-12);
  assert.ok(Math.abs(o[1].profit_per_unit - 1.15) < 1e-12);
  assert.deepEqual([o[3].result, o[3].clv, o[3].close_ev, o[3].profit_per_unit], ['WIN', null, null, 2.4]);
  assert.deepEqual([o[4].result, o[4].profit_per_unit, o[4].clv], ['VOID', null, null]);
  assert.equal(o[2], undefined);

  const again = await lineSettle({ store, now: () => NOW });
  assert.deepEqual([again.pending, again.settled], [1, 0]);
});

test('the close is de-vigged with the method of the candidate rule version (1.0.0 proportional, 1.1.0 power)', async () => {
  const { fake } = setup([]);
  const store = createAnalysisStore(fake); // real store: reads the view, then each candidate's rule_version
  for (const [id, version] of [[11, '1.0.0'], [12, '1.1.0']]) {
    fake.table('line_candidates').push({ id, rule_version: version });
    fake.table('unsettled_line_candidates').push({ candidate_id: id, fixture_id: 'f1', selection_code: 'AWAY', price: 4.6, fixture_status: 'FINISHED', home_goals: 0, away_goals: 1, kickoff_utc: '2026-10-18T13:30:00Z' });
  }
  const pending = await store.unsettledLineCandidates();
  assert.deepEqual(pending.map((p) => [p.candidateId, p.ruleVersion]), [[11, '1.0.0'], [12, '1.1.0']]);
  await lineSettle({ store, now: () => NOW });
  const o = Object.fromEntries(fake.table('line_candidate_outcomes').map((x) => [x.candidate_id, x]));
  const close = { HOME: 1.9, DRAW: 3.7, AWAY: 4.3 };
  assert.ok(Math.abs(o[11].p_pin_close - devig('1X2', close).pFair.AWAY) < 1e-12);
  assert.ok(Math.abs(o[12].p_pin_close - devigPower('1X2', close).pFair.AWAY) < 1e-12);
  assert.ok(o[12].close_ev < o[11].close_ev); // the 4.30 longshot is worth less under the power method
  assert.equal(o[11].clv, o[12].clv); // CLV does not depend on the de-vig
});

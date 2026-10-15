'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLineShopping, settleLineCandidate, meanCi, median } = require('../../src/domain/lineShopping');
const { defaultLineConfig, lineConfigHash, LINE_PARAMETERS } = require('../../src/domain/lineShopping/config');
const { lineReport } = require('../../src/domain/lineShopping/report');

const NOW = new Date('2026-10-17T08:30:00Z');
const CAPTURED = '2026-10-17T08:20:00Z';
const KICKOFF = '2026-10-18T13:30:00Z';
let sid = 0;
const q = (bookmakerKey, selectionCode, decimalOdds, over = {}) => ({
  snapshotId: ++sid, sourceProvider: 'the_odds_api', providerEventId: 'ev1', bookmakerKey, bookmakerName: bookmakerKey,
  marketCode: '1X2', selectionCode, line: null, decimalOdds, kind: 'pre_match', capturedAt: CAPTURED, sourceTimestamp: null, ...over,
});
const set = (k, h, d, a, over) => [q(k, 'HOME', h, over), q(k, 'DRAW', d, over), q(k, 'AWAY', a, over)];
// Pinnacle 2.00/3.60/4.00 → p_home = 0.5 / 1.02778 = 0.48649.
const PIN = () => set('pinnacle', 2.0, 3.6, 4.0);
const MARKET = () => ['b1', 'b2', 'b3', 'b4'].flatMap((k) => set(k, 1.95, 3.4, 3.8));
const sel = (r, scope, s) => r.selections.find((x) => x.scope === scope && x.selectionCode === s);
const run = (quotes, over = {}) => evaluateLineShopping({ quotes, kickoffUtc: KICKOFF, now: NOW, ...over });

test('every parameter is classified and the config hash is stable', () => {
  assert.ok(Object.values(LINE_PARAMETERS).every((p) => p.class === 'PROVISIONAL'));
  assert.equal(lineConfigHash(defaultLineConfig()), lineConfigHash(defaultLineConfig()));
  assert.notEqual(lineConfigHash(defaultLineConfig()), lineConfigHash({ ...defaultLineConfig(), minEdge: 0.02 }));
});

test('edge = de-vigged Pinnacle probability × best price − 1; all gates passed → LINE_VALUE in both scopes', () => {
  const r = run([...PIN(), ...MARKET(), ...set('unibet_nl', 2.15, 3.3, 3.7)]);
  const pHome = 0.5 / (0.5 + 1 / 3.6 + 0.25);
  assert.ok(Math.abs(r.reference.pFair.HOME - pHome) < 1e-12);
  assert.ok(Math.abs(r.reference.overround - (0.5 + 1 / 3.6 + 0.25 - 1)) < 1e-12);
  for (const scope of ['all', 'playable']) {
    const s = sel(r, scope, 'HOME');
    assert.equal(s.status, 'LINE_VALUE', JSON.stringify(s));
    assert.equal(s.bookmakerKey, 'unibet_nl');
    assert.ok(Math.abs(s.edge - (pHome * 2.15 - 1)) < 1e-12);
    assert.equal(s.nPrices, 5);
    assert.equal(s.medianPrice, 1.95);
    assert.equal(s.pinOdds, 2.0);
  }
  assert.equal(sel(r, 'all', 'DRAW').status, 'NO_VALUE');
});

test('the playable scope uses only the PO bookmakers; median and depth stay market-wide', () => {
  const r = run([...PIN(), ...MARKET(), ...set('onexbet', 2.2, 3.4, 3.8), ...set('unibet_se', 2.0, 3.3, 3.7)]);
  assert.equal(sel(r, 'all', 'HOME').bookmakerKey, 'onexbet');
  assert.equal(sel(r, 'all', 'HOME').status, 'LINE_VALUE');
  const p = sel(r, 'playable', 'HOME');
  assert.equal(p.bookmakerKey, 'unibet_se');
  assert.equal(p.nPrices, 6);
  // 2.00: edge −2.7% → NO_VALUE
  assert.equal(p.status, 'NO_VALUE');
  const none = run([...PIN(), ...MARKET()]);
  assert.deepEqual([sel(none, 'playable', 'HOME').status, sel(none, 'playable', 'HOME').reasonCodes], ['INSUFFICIENT_DATA', ['NO_PLAYABLE_PRICE']]);
});

test('a positive edge that fails a gate is WATCHLIST with every failed gate listed', () => {
  // 0.48649 × 2.09 − 1 = +1.7%: positive but below the 3% minimum.
  const below = run([...PIN(), ...MARKET(), ...set('b5', 2.09, 3.4, 3.8)]);
  const s = sel(below, 'all', 'HOME');
  assert.equal(s.status, 'WATCHLIST');
  assert.deepEqual(s.reasonCodes, ['EDGE_BELOW_MIN']);

  // Pinnacle disagrees with the whole market: every book at 2.20 → price not above the median.
  const outlier = run([...PIN(), ...['b1', 'b2', 'b3', 'b4', 'b5'].flatMap((k) => set(k, 2.2, 3.4, 3.8))]);
  assert.deepEqual(sel(outlier, 'all', 'HOME').reasonCodes, ['SHARP_OUTLIER']);

  // thin market and odds range
  const thin = run([...set('pinnacle', 7.0, 4.5, 1.5), ...set('b1', 7.8, 4.4, 1.45)]);
  assert.deepEqual(sel(thin, 'all', 'HOME').reasonCodes, ['ODDS_OUT_OF_RANGE', 'THIN_MARKET']);

  // kickoff within 30 minutes of the capture
  const late = evaluateLineShopping({ quotes: [...PIN(), ...MARKET(), ...set('b5', 2.15, 3.3, 3.7)], kickoffUtc: '2026-10-17T08:40:00Z', now: NOW });
  assert.deepEqual(sel(late, 'all', 'HOME').reasonCodes, ['KICKOFF_TOO_CLOSE']);
});

test('no complete fresh Pinnacle set → INSUFFICIENT_DATA; exchanges and aggregates are never the price', () => {
  const partial = run([q('pinnacle', 'HOME', 2.0), q('pinnacle', 'DRAW', 3.6), ...MARKET()]);
  assert.equal(partial.reference, null);
  assert.ok(partial.selections.every((s) => s.status === 'INSUFFICIENT_DATA' && s.reasonCodes.includes('NO_SHARP_REFERENCE')));

  const stale = run([...set('pinnacle', 2.0, 3.6, 4.0, { capturedAt: '2026-10-17T01:00:00Z' }), ...MARKET()]);
  assert.equal(stale.reference, null);

  const ex = run([...PIN(), ...MARKET(), ...set('betfair_ex_eu', 2.5, 3.6, 4.2), ...set('matchbook', 2.5, 3.6, 4.2)]);
  assert.equal(sel(ex, 'all', 'HOME').bookmakerKey, 'b1');
  assert.equal(sel(ex, 'all', 'HOME').nPrices, 4);
});

test('the latest complete Pinnacle capture is the reference; the result does not depend on quote order', () => {
  const older = set('pinnacle', 2.4, 3.4, 3.0, { capturedAt: '2026-10-17T06:00:00Z' });
  const quotes = [...older, ...PIN(), ...MARKET(), ...set('unibet_nl', 2.15, 3.3, 3.7)];
  const a = run(quotes);
  const b = run([...quotes].reverse());
  assert.equal(a.reference.capturedAt, CAPTURED);
  assert.deepEqual(a, b);
});

test('settlement: result, paper profit, CLV and close-EV against the de-vigged Pinnacle close', () => {
  const fx = (status, h, a) => ({ status, homeGoals: h, awayGoals: a });
  const close = { HOME: 1.9, DRAW: 3.7, AWAY: 4.3 };
  const r = settleLineCandidate({ selectionCode: 'HOME', price: 2.15 }, fx('FINISHED', 2, 1), close);
  const pClose = (1 / 1.9) / (1 / 1.9 + 1 / 3.7 + 1 / 4.3);
  assert.equal(r.result, 'WIN');
  assert.ok(Math.abs(r.profit - 1.15) < 1e-12);
  assert.ok(Math.abs(r.clv - (2.15 / 1.9 - 1)) < 1e-12);
  assert.ok(Math.abs(r.closeEv - (pClose * 2.15 - 1)) < 1e-12);
  assert.equal(settleLineCandidate({ selectionCode: 'DRAW', price: 3.5 }, fx('FINISHED', 2, 1), close).profit, -1);
  assert.deepEqual(settleLineCandidate({ selectionCode: 'AWAY', price: 4 }, fx('FINISHED', 0, 0), null), { result: 'LOSS', profit: -1, closeOdds: null, pClose: null, clv: null, closeEv: null });
  assert.equal(settleLineCandidate({ selectionCode: 'HOME', price: 2 }, fx('CANCELLED', null, null), close).result, 'VOID');
  assert.equal(settleLineCandidate({ selectionCode: 'HOME', price: 2 }, fx('POSTPONED', null, null), close), null);
});

test('meanCi and median', () => {
  assert.deepEqual(meanCi([]), { n: 0, mean: null, low: null, high: null });
  const m = meanCi([0.1, -0.1, 0.2, 0]);
  assert.ok(Math.abs(m.mean - 0.05) < 1e-12);
  const sd = Math.sqrt(((0.05) ** 2 + 0.15 ** 2 + 0.15 ** 2 + 0.05 ** 2) / 3);
  assert.ok(Math.abs(m.high - (0.05 + (1.96 * sd) / 2)) < 1e-12);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('report: first LINE_VALUE row per fixture selection and scope; verdict only after the agreed sample', () => {
  const start = Date.parse('2026-10-15T08:00:00Z');
  const mk = (id, scope, fixtureId, clv, closeEv, profit, days = 0) => ({
    id, scope, fixtureId, selectionCode: 'HOME', createdAt: new Date(start + days * 86400000).toISOString(),
    outcome: profit === undefined ? null : { result: profit > 0 ? 'WIN' : 'LOSS', clv, closeEv, profit },
  });
  const rows = [mk(1, 'all', 'f1', 0.05, 0.04, 1.1), mk(2, 'all', 'f1', 0.0, -0.5, -1), mk(3, 'all', 'f2', 0.01, 0.02, -1), mk(4, 'playable', 'f2'), mk(5, 'all', 'f3', null, null, -1)];
  rows[4].outcome.clv = null;
  const r = lineReport(rows, { now: new Date(start + 14 * 86400000) });
  const a = r.scopes.all;
  assert.deepEqual([a.candidates, a.settled, a.withClosing, a.pending, a.wins, a.verdict], [3, 3, 2, 0, 1, 'IN_PROGRESS']);
  assert.ok(Math.abs(a.closeEv.mean - 0.03) < 1e-12);
  assert.ok(Math.abs(a.roi - (1.1 - 2) / 3) < 1e-12);
  assert.deepEqual([r.scopes.playable.candidates, r.scopes.playable.pending], [1, 1]);
  assert.ok(Math.abs(r.weeks - 2) < 1e-9);

  const many = Array.from({ length: 150 }, (_, i) => mk(i + 1, 'all', `g${i}`, 0.02, i % 2 ? 0.03 : 0.01, -1));
  assert.equal(lineReport(many, { now: new Date(start + 43 * 86400000) }).scopes.all.verdict, 'EDGE_CONFIRMED');
  assert.equal(lineReport(many, { now: new Date(start + 41 * 86400000) }).scopes.all.verdict, 'IN_PROGRESS');
  const neg = many.map((c) => ({ ...c, outcome: { ...c.outcome, closeEv: -0.01 } }));
  assert.equal(lineReport(neg, { now: new Date(start + 43 * 86400000) }).scopes.all.verdict, 'STOP');
  const wide = many.map((c, i) => ({ ...c, outcome: { ...c.outcome, closeEv: i % 2 ? 0.5 : -0.49 } }));
  assert.equal(lineReport(wide, { now: new Date(start + 43 * 86400000) }).scopes.all.verdict, 'EXTEND');
  assert.equal(lineReport([], { now: new Date(start) }).startedAt, null);
});

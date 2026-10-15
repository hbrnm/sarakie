'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLineShopping, settleLineCandidate, meanCi, clusterMeanCi, getTQuantile975, median } = require('../../src/domain/lineShopping');
const { defaultLineConfig, lineConfigHash, LINE_PARAMETERS, LINE_RULE_VERSION, devigMethodForRule } = require('../../src/domain/lineShopping/config');
const { lineReport, leadBucket } = require('../../src/domain/lineShopping/report');
const { devig, devigPower } = require('../../src/domain/odds');

const NOW = new Date('2026-10-17T08:30:00Z');
const CAPTURED = '2026-10-17T08:20:00Z';
const KICKOFF = '2026-10-18T13:30:00Z';
let sid = 0;
const q = (bookmakerKey, selectionCode, decimalOdds, over = {}) => ({
  snapshotId: ++sid, sourceProvider: 'the_odds_api', providerEventId: 'ev1', bookmakerKey, bookmakerName: bookmakerKey,
  marketCode: '1X2', selectionCode, line: null, decimalOdds, kind: 'pre_match', capturedAt: CAPTURED, sourceTimestamp: null, ...over,
});
const set = (k, h, d, a, over) => [q(k, 'HOME', h, over), q(k, 'DRAW', d, over), q(k, 'AWAY', a, over)];
// Pinnacle 2.00/3.60/4.00 → proportional p_home = 0.5 / 1.02778 = 0.48649; power p_home ≈ 0.49077.
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
  const k = r.reference.devigK;
  const pHome = 0.5 ** k;
  assert.equal(r.reference.devigMethod, 'power');
  assert.ok(Math.abs(0.5 ** k + (1 / 3.6) ** k + 0.25 ** k - 1) < 1e-9);
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

  // Rule 1.0.0 behaviour is reproducible with the proportional method.
  const prop = run([...PIN(), ...MARKET(), ...set('unibet_nl', 2.15, 3.3, 3.7)], { config: { ...defaultLineConfig(), devigMethod: 'proportional' } });
  assert.equal(prop.reference.devigMethod, 'proportional');
  assert.ok(Math.abs(prop.reference.pFair.HOME - 0.5 / (0.5 + 1 / 3.6 + 0.25)) < 1e-12);
});

test('power de-vig: Σp = 1, longshots lower than proportional, favourites higher; deterministic', () => {
  const cases = {
    balanced: { HOME: 2.6, DRAW: 3.2, AWAY: 2.8 },
    pinnacleLike: { HOME: 2.0, DRAW: 3.6, AWAY: 4.0 },
    heavyFavourite: { HOME: 1.25, DRAW: 6.5, AWAY: 12 },
    awayFavourite: { HOME: 5.5, DRAW: 4.2, AWAY: 1.6 },
  };
  for (const [name, odds] of Object.entries(cases)) {
    const pw = devigPower('1X2', odds);
    const pr = devig('1X2', odds);
    assert.equal(pw.method, 'power', name);
    assert.ok(pw.k > 1 && pw.k < 5, name);
    const sum = Object.values(pw.pFair).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-7, `${name}: Σp = ${sum}`);
    assert.ok(pw.overround > 0);
    const order = Object.keys(odds).sort((a, b) => odds[a] - odds[b]);
    const [fav, longshot] = [order[0], order[order.length - 1]];
    assert.ok(pw.pFair[longshot] < pr.pFair[longshot], `${name}: longshot ${pw.pFair[longshot]} < ${pr.pFair[longshot]}`);
    assert.ok(pw.pFair[fav] > pr.pFair[fav], `${name}: favourite`);
    assert.deepEqual(devigPower('1X2', { ...odds }), pw);
  }
  // Heavy favourite: the 12.00 longshot loses about a tenth of its proportional probability.
  const h = cases.heavyFavourite;
  assert.ok(devigPower('1X2', h).pFair.AWAY < 0.073 && devig('1X2', h).pFair.AWAY > 0.08);
  // Odds in the 3.50–6.00 band: power is strictly lower.
  assert.ok(devigPower('1X2', cases.awayFavourite).pFair.HOME < devig('1X2', cases.awayFavourite).pFair.HOME);
});

test('power de-vig falls back to proportional when there is no margin or the input is degenerate', () => {
  const fair = devigPower('1X2', { HOME: 2, DRAW: 4, AWAY: 4 }); // Σ 1/odds = 1
  assert.deepEqual([fair.method, fair.k], ['proportional', null]);
  assert.deepEqual(fair.pFair, devig('1X2', { HOME: 2, DRAW: 4, AWAY: 4 }).pFair);
  const arb = devigPower('1X2', { HOME: 2.2, DRAW: 4, AWAY: 4.4 }); // Σ < 1
  assert.equal(arb.method, 'proportional');
  assert.ok(Math.abs(Object.values(arb.pFair).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  const huge = devigPower('1X2', { HOME: 1.01, DRAW: 1.01, AWAY: 1.01 }); // root not in [1, 5]
  assert.equal(huge.method, 'proportional');
  assert.equal(devigPower('1X2', { HOME: 2, DRAW: 3.4 }).complete, false);
  assert.equal(devigPower('DC', { '1X': 1.3, 12: 1.3, X2: 1.6 }).complete, false);
});

test('rule version 1.1.0 uses the power method; 1.0.0 rows stay proportional', () => {
  assert.equal(LINE_RULE_VERSION, '1.1.0');
  assert.equal(defaultLineConfig().devigMethod, 'power');
  assert.equal(devigMethodForRule('1.0.0'), 'proportional');
  assert.equal(devigMethodForRule('1.1.0'), 'power');
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
  const pClose = devigPower('1X2', close).pFair.HOME; // current rule: power method
  const old = settleLineCandidate({ selectionCode: 'HOME', price: 2.15, ruleVersion: '1.0.0' }, fx('FINISHED', 2, 1), close);
  assert.ok(Math.abs(old.closeEv - (((1 / 1.9) / (1 / 1.9 + 1 / 3.7 + 1 / 4.3)) * 2.15 - 1)) < 1e-12);
  assert.ok(Math.abs(old.clv - r.clv) < 1e-15);
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

test('getTQuantile975: table for small df, Cornish–Fisher above, tends to 1.96', () => {
  assert.equal(getTQuantile975(1), 12.706);
  assert.equal(getTQuantile975(9), 2.262); // G = 10
  assert.ok(getTQuantile975(9) > 2.2);
  assert.ok(Math.abs(getTQuantile975(74) - 1.9925) < 0.001); // G = 75, table value 1.99254
  assert.ok(Math.abs(getTQuantile975(10000) - 1.96) < 0.001);
  // Cornish–Fisher against tabulated quantiles just above the table.
  for (const [df, t] of [[11, 2.201], [20, 2.086], [30, 2.0423], [120, 1.9799]]) assert.ok(Math.abs(getTQuantile975(df) - t) < 0.001, `df ${df}`);
  // Decreasing in df, always above z.
  for (let df = 1; df < 200; df += 1) assert.ok(getTQuantile975(df) > getTQuantile975(df + 1) && getTQuantile975(df + 1) > 1.95996398);
  for (const bad of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => getTQuantile975(bad), RangeError);
});

test('clusterMeanCi: same SE as meanCi with one observation per cluster, t(G − 1) interval; wider when a fixture repeats', () => {
  const xs = [0.1, -0.1, 0.2, 0, 0.05, -0.02];
  const iid = meanCi(xs);
  const one = clusterMeanCi(xs.map((value, i) => ({ value, cluster: `f${i}` })));
  assert.equal(one.clusters, 6);
  const iidSe = (iid.high - iid.mean) / 1.96;
  assert.ok(Math.abs(one.se - iidSe) < 1e-12);
  assert.ok(Math.abs(one.high - (one.mean + getTQuantile975(5) * one.se)) < 1e-12);
  assert.ok(Math.abs(one.low - (one.mean - 2.571 * one.se)) < 1e-12);

  // The same three results seen twice each (correlated rows of one fixture): the mean is
  // unchanged, the naive IID interval shrinks, the clustered one does not.
  const base = [0.1, -0.1, 0.2];
  const dup = [...base, ...base];
  const naive = meanCi(dup);
  const cl = clusterMeanCi(dup.map((value, i) => ({ value, cluster: `f${i % 3}` })));
  const ref = clusterMeanCi(base.map((value, i) => ({ value, cluster: `f${i}` })));
  assert.deepEqual([cl.n, cl.clusters], [6, 3]);
  assert.ok(Math.abs(cl.mean - ref.mean) < 1e-12);
  assert.ok(cl.high - cl.low > naive.high - naive.low);
  assert.ok(Math.abs((cl.high - cl.low) - (ref.high - ref.low)) < 1e-12);
  // CR1 by hand: residual sums per fixture, G / (G − 1) · Σ S_g² / N².
  const m = 0.2 / 3;
  const se = Math.sqrt((3 / 2) * base.reduce((a, v) => a + (2 * (v - m)) ** 2, 0) / 36);
  assert.ok(Math.abs(cl.se - se) < 1e-12);

  assert.deepEqual(clusterMeanCi([]), { n: 0, clusters: 0, mean: null, se: null, low: null, high: null });
  const single = clusterMeanCi([{ value: 0.1, cluster: 'f' }, { value: 0.3, cluster: 'f' }]);
  assert.deepEqual([single.clusters, single.low, single.high], [1, null, null]);
  assert.ok(Math.abs(single.mean - 0.2) < 1e-12);
  // Row order does not change the result.
  const rows = dup.map((value, i) => ({ value, cluster: `f${i % 3}` }));
  assert.deepEqual(clusterMeanCi([...rows].reverse()).clusters, cl.clusters);
  assert.ok(Math.abs(clusterMeanCi([...rows].reverse()).se - cl.se) < 1e-15);
});

test('report: N_fixtures, clustered CI, current rule version only, and time-to-kickoff buckets', () => {
  const start = Date.parse('2026-10-15T08:00:00Z');
  const at = (h) => new Date(start + h * 3600000).toISOString();
  const mk = (id, fixtureId, selectionCode, leadHours, clv, closeEv, ruleVersion = '1.1.0') => ({
    id, ruleVersion, scope: 'all', fixtureId, selectionCode, createdAt: at(0), kickoffUtc: at(leadHours),
    outcome: { result: 'LOSS', clv, closeEv, profit: -1 },
  });
  const rows = [
    mk(1, 'f1', 'HOME', 6, 0.04, 0.03), mk(2, 'f1', 'AWAY', 6, 0.02, 0.01), // same fixture
    mk(3, 'f2', 'HOME', 30, -0.01, -0.02), mk(4, 'f3', 'DRAW', 47, 0.03, 0.05),
    mk(5, 'f4', 'HOME', 6, 0.5, 0.5, '1.0.0'), // earlier rule: excluded
  ];
  const r = lineReport(rows, { now: new Date(start + 7 * 86400000) });
  const a = r.scopes.all;
  assert.equal(r.ruleVersion, '1.1.0');
  assert.equal(r.otherVersionRows, 1);
  assert.deepEqual([a.withClosing, a.fixturesWithClosing, a.closeEv.clusters], [4, 3, 3]);
  assert.ok(Math.abs(a.closeEv.mean - 0.0175) < 1e-12);
  assert.deepEqual([a.byLead.lt12.candidates, a.byLead.lt12.fixtures, a.byLead.h12to48.candidates, a.byLead.other.candidates], [2, 1, 2, 0]);
  assert.ok(Math.abs(a.byLead.lt12.clv - 0.03) < 1e-12);
  assert.ok(Math.abs(a.byLead.h12to48.closeEv - 0.015) < 1e-12);
  assert.equal(a.byLead.other.clv, null);
  assert.deepEqual(['lt12', 'h12to48', 'h12to48', 'other', 'other'].map((b, i) => b === leadBucket({ createdAt: at(0), kickoffUtc: at([11.9, 12, 48, 49, -1][i]) })), [true, true, true, true, true]);

  // 150 rows from 75 fixtures, two perfectly correlated rows each: clustered CI is wider than the IID one.
  const many = Array.from({ length: 150 }, (_, i) => mk(i + 10, `g${i % 75}`, i < 75 ? 'HOME' : 'AWAY', 20, 0.02, (i % 75) % 2 ? 0.06 : -0.04));
  const m = lineReport(many, { now: new Date(start + 43 * 86400000) }).scopes.all;
  const iid = meanCi(many.map((c) => c.outcome.closeEv));
  assert.deepEqual([m.withClosing, m.fixturesWithClosing], [150, 75]);
  assert.ok(iid.low > 0, 'an IID interval would confirm the edge');
  assert.ok(m.closeEv.low < 0, 'the clustered interval does not');
  assert.equal(m.verdict, 'EXTEND');

  // D-25: 150 candidates from fewer than 75 distinct fixtures → no verdict yet.
  const few = many.map((c, i) => ({ ...c, fixtureId: `g${i % 74}`, selectionCode: ['HOME', 'DRAW', 'AWAY'][Math.floor(i / 74)], outcome: { ...c.outcome, closeEv: 0.05 } }));
  const f = lineReport(few, { now: new Date(start + 43 * 86400000) }).scopes.all;
  assert.deepEqual([f.withClosing, f.fixturesWithClosing, f.verdict], [150, 74, 'IN_PROGRESS']);
  const enough = many.map((c) => ({ ...c, outcome: { ...c.outcome, closeEv: 0.05 } }));
  assert.equal(lineReport(enough, { now: new Date(start + 43 * 86400000) }).scopes.all.verdict, 'EDGE_CONFIRMED');
});

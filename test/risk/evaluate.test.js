'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateFixture } = require('../../src/domain/risk/evaluate');
const { defaultRiskConfig, riskConfigHash, RISK_PARAMETERS } = require('../../src/domain/risk/config');
const { canonicalJson } = require('../../src/domain/model/config');
const { NOW, FIXTURE, EST, quote, book } = require('./helpers');

const scanner = (quotes, over = {}) =>
  evaluateFixture({ fixture: FIXTURE, estimate: EST, quotes, fetchedMarkets: ['1X2', 'OU'], mode: 'scanner', now: NOW, ...over });
const sel = (r, m, s, l = null) => r.selections.find((x) => x.marketCode === m && x.selectionCode === s && x.line === l);

test('every in-scope selection gets exactly one status; versions are stamped', () => {
  const r = scanner([...book('a'), ...book('b'), ...book('c')]);
  assert.equal(r.selections.length, 16);
  assert.ok(r.selections.every((s) => ['INSUFFICIENT_DATA', 'NO_VALUE', 'WATCHLIST', 'QUALIFIED'].includes(s.status)));
  assert.equal(Object.values(r.summary).reduce((a, b) => a + b, 0), 16);
  assert.equal(r.modelVersion, '1.0.0');
  assert.match(r.riskConfigHash, /^[0-9a-f]{64}$/);
});

test('markets not fetched by the scanner are INSUFFICIENT_DATA (ODDS_NOT_FETCHED, D-11)', () => {
  const r = scanner([...book('a'), ...book('b'), ...book('c')]);
  for (const m of ['DC', 'DNB', 'BTTS']) {
    for (const s of r.selections.filter((x) => x.marketCode === m)) assert.deepEqual(s.reasonCodes, ['ODDS_NOT_FETCHED']);
  }
});

test('fairly priced markets with a margin give NO_VALUE', () => {
  const r = scanner([...book('a'), ...book('b'), ...book('c')]);
  assert.equal(sel(r, '1X2', 'HOME').status, 'NO_VALUE');
  assert.deepEqual(sel(r, '1X2', 'HOME').reasonCodes, ['EV_NOT_POSITIVE']);
});

test('a well-supported positive-EV price is QUALIFIED; the same price at one book only is WATCHLIST', () => {
  // Over 2.5 priced ~7% above model-fair at three books, with a normal positive margin overall.
  const boost = { market: 'OU', sel: 'OVER', line: 2.5, factor: 1.18 };
  const r = scanner([...book('a', { margin: 0.1, boost }), ...book('b', { margin: 0.1, boost }), ...book('c', { margin: 0.1, boost })]);
  const s = sel(r, 'OU', 'OVER', 2.5);
  assert.equal(s.status, 'QUALIFIED', JSON.stringify(s));
  assert.ok(s.ev >= 0.05);
  assert.equal(s.bookmakerCount, 3);
  const thin = scanner([...book('a', { margin: 0.1, boost }), ...book('b', { margin: 0.1, boost })]);
  assert.ok(sel(thin, 'OU', 'OVER', 2.5).reasonCodes.includes('THIN_MARKET'));
  assert.equal(sel(thin, 'OU', 'OVER', 2.5).status, 'WATCHLIST');
});

test('qualification gates are all reported, not just the first', () => {
  // Two books, away price doubled: thin market and a negative (abnormal) overround at the same time.
  const boost = { market: '1X2', sel: 'AWAY', factor: 2 };
  const r = scanner([...book('a', { boost }), ...book('b', { boost })]);
  const s = sel(r, '1X2', 'AWAY');
  assert.equal(s.status, 'WATCHLIST');
  assert.ok(s.reasonCodes.includes('THIN_MARKET'), JSON.stringify(s.reasonCodes));
  assert.ok(s.reasonCodes.includes('OVERROUND_ABNORMAL'), JSON.stringify(s.reasonCodes));
  assert.ok(s.reasonCodes.length >= 2);
});

test('a single outlier price is excluded from the best quote', () => {
  const outlier = book('x', { boost: { market: 'OU', sel: 'OVER', line: 2.5, factor: 1.6 } });
  const r = scanner([...book('a'), ...book('b'), ...book('c'), ...outlier]);
  const s = sel(r, 'OU', 'OVER', 2.5);
  assert.notEqual(s.bestQuote.bookmakerKey, 'x');
  assert.deepEqual(s.notes, ['PRICE_OUTLIER_EXCLUDED']);
});

test('stale odds: scanner tolerates 6 h, on-demand only 2 h (option A)', () => {
  const old = (q) => ({ ...q, capturedAt: new Date(NOW.getTime() - 3 * 3600000).toISOString() });
  const quotes = [...book('a'), ...book('b'), ...book('c')].map(old);
  assert.notEqual(sel(scanner(quotes), '1X2', 'HOME').status, 'INSUFFICIENT_DATA');
  const od = scanner(quotes, { mode: 'on_demand', fetchedMarkets: ['1X2', 'OU', 'DC', 'DNB', 'BTTS'] });
  assert.deepEqual(sel(od, '1X2', 'HOME').reasonCodes, ['ODDS_STALE']);
  const srcOld = [...book('a'), ...book('b'), ...book('c')].map((q) => ({ ...q, sourceTimestamp: new Date(NOW.getTime() - 7 * 3600000).toISOString() }));
  assert.deepEqual(sel(scanner(srcOld), '1X2', 'HOME').reasonCodes, ['ODDS_STALE']);
});

test('missing and invalid odds', () => {
  const r = scanner([...book('a')].filter((q) => !(q.marketCode === 'OU' && q.line === 1.5)));
  assert.deepEqual(sel(r, 'OU', 'OVER', 1.5).reasonCodes, ['ODDS_MISSING']);
  const bad = scanner([quote('a', '1X2', 'HOME', null, 250)]);
  assert.deepEqual(sel(bad, '1X2', 'HOME').reasonCodes, ['ODDS_INVALID']);
});

test('incomplete set at the chosen bookmaker → MARKET_INCOMPLETE, never normalized', () => {
  const boost = { market: 'OU', sel: 'OVER', line: 2.5, factor: 1.18 };
  const q = [...book('a', { margin: 0.1, boost }), ...book('b', { margin: 0.1, boost }), ...book('c', { margin: 0.1, boost })].filter((x) => !(x.marketCode === 'OU' && x.selectionCode === 'UNDER' && x.line === 2.5));
  const s = sel(scanner(q), 'OU', 'OVER', 2.5);
  assert.ok(s.reasonCodes.includes('MARKET_INCOMPLETE'));
  assert.equal(s.pDevig, null);
  assert.notEqual(s.status, 'QUALIFIED');
});

test('fixture-level gates apply to every selection', () => {
  const quotes = [...book('a'), ...book('b'), ...book('c')];
  const close = scanner(quotes, { now: new Date(Date.parse(FIXTURE.kickoffUtc) - 10 * 60000) });
  assert.ok(close.selections.every((s) => s.status === 'INSUFFICIENT_DATA' && s.reasonCodes.includes('KICKOFF_TOO_CLOSE')));
  const started = scanner(quotes, { fixture: { ...FIXTURE, status: 'LIVE' } });
  assert.ok(started.selections.every((s) => s.reasonCodes.includes('FIXTURE_NOT_SCHEDULED')));
  const noModel = scanner(quotes, { estimate: { ...EST, status: 'INSUFFICIENT_DATA', reasons: ['PROMOTED_TEAM_NO_HISTORY'] } });
  assert.ok(noModel.selections.every((s) => s.status === 'INSUFFICIENT_DATA' && s.reasonCodes[0] === 'PROMOTED_TEAM_NO_HISTORY'));
});

test('DNB uses push-aware EV and the conditional model probability; DC uses de-vigged 1X2', () => {
  const extra = [];
  for (const b of ['a', 'b', 'c']) {
    const dnb = EST.markets.DNB;
    extra.push(quote(b, 'DNB', 'HOME', null, Math.round(dnb.HOME.fairOdds * 1.1 * 100) / 100), quote(b, 'DNB', 'AWAY', null, Math.round((dnb.AWAY.fairOdds / 1.15) * 100) / 100));
    extra.push(quote(b, 'DC', '1X', null, Math.round((EST.markets.DC['1X'].fairOdds / 1.04) * 100) / 100));
  }
  const r = scanner([...book('a'), ...book('b'), ...book('c'), ...extra], { mode: 'on_demand', fetchedMarkets: ['1X2', 'OU', 'DNB', 'DC'] });
  const d = sel(r, 'DNB', 'HOME');
  const { win, loss } = EST.markets.DNB.HOME;
  assert.ok(Math.abs(d.ev - (win * (d.bestQuote.decimalOdds - 1) - loss)) < 1e-12);
  assert.ok(d.pDevig > 0 && d.pDevig < 1);
  const dc = sel(r, 'DC', '1X');
  assert.ok(dc.pDevig > 0.3 && dc.pDevig < 1);
});

test('determinism and config hash', () => {
  const quotes = [...book('a'), ...book('b'), ...book('c')];
  assert.equal(canonicalJson(scanner(quotes)), canonicalJson(scanner([...quotes].reverse())));
  const h0 = riskConfigHash(defaultRiskConfig());
  for (const k of Object.keys(RISK_PARAMETERS)) {
    const c = defaultRiskConfig();
    c[k] += 1;
    assert.notEqual(riskConfigHash(c), h0, k);
  }
  assert.ok(Object.values(RISK_PARAMETERS).every((p) => p.class === 'PROVISIONAL'));
});

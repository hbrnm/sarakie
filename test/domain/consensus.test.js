'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { marketConsensus } = require('../../src/domain/odds/consensus');

const q = (bookmakerKey, marketCode, selectionCode, line, decimalOdds, capturedAt = '2026-10-15T08:00:00.000Z') => ({
  bookmakerKey, marketCode, selectionCode, line, decimalOdds, capturedAt, kind: 'pre_match',
});

test('consensus is the mean of complete per-bookmaker de-vigged sets; incomplete sets are ignored', () => {
  const quotes = [
    q('a', '1X2', 'HOME', null, 2), q('a', '1X2', 'DRAW', null, 4), q('a', '1X2', 'AWAY', null, 4),
    q('b', '1X2', 'HOME', null, 2.5), q('b', '1X2', 'DRAW', null, 2.5), q('b', '1X2', 'AWAY', null, 5),
    q('c', '1X2', 'HOME', null, 1.5), // incomplete: never normalized
    q('a', 'OU', 'OVER', 2.5, 1.9), q('a', 'OU', 'UNDER', 2.5, 1.9),
    q('a', 'OU', 'OVER', 3.5, 3.0),
  ];
  const r = marketConsensus(quotes);
  assert.equal(r['1X2'].books, 2);
  // a: .50/.25/.25, b: .40/.40/.20 (both already sum to 1) → mean .45/.325/.225
  assert.ok(Math.abs(r['1X2'].HOME - 0.45) < 1e-12);
  assert.ok(Math.abs(r['1X2'].DRAW - 0.325) < 1e-12);
  assert.ok(Math.abs(r['1X2'].AWAY - 0.225) < 1e-12);
  assert.deepEqual([r.OU.line, r.OU.books], [2.5, 1]);
  assert.ok(Math.abs(r.OU.OVER - 0.5) < 1e-9); // power method: bisection tolerance 1e-9
});

test('margin is removed, the latest quote per bookmaker wins, order does not matter', () => {
  const quotes = [
    q('a', 'OU', 'OVER', 2.5, 3.0, '2026-10-15T07:00:00.000Z'),
    q('a', 'OU', 'OVER', 2.5, 1.8, '2026-10-15T08:00:00.000Z'),
    q('a', 'OU', 'UNDER', 2.5, 1.8, '2026-10-15T08:00:00.000Z'),
  ];
  const r = marketConsensus(quotes);
  assert.ok(Math.abs(r.OU.OVER - 0.5) < 1e-9);
  assert.equal(r.latestCapturedAt, '2026-10-15T08:00:00.000Z');
  assert.deepEqual(marketConsensus([...quotes].reverse()), r);
  assert.deepEqual(marketConsensus([]), { '1X2': null, OU: null, latestCapturedAt: null });
});

test('D-26: each bookmaker set is de-vigged with the power method (longshot lower than proportional)', () => {
  const { devig, devigPower } = require('../../src/domain/odds');
  const set = { HOME: 1.25, DRAW: 6.5, AWAY: 12 };
  const quotes = Object.entries(set).map(([s, o]) => q('a', '1X2', s, null, o));
  const r = marketConsensus(quotes);
  assert.ok(Math.abs(r['1X2'].AWAY - devigPower('1X2', set).pFair.AWAY) < 1e-12);
  assert.ok(r['1X2'].AWAY < devig('1X2', set).pFair.AWAY);
  assert.ok(Math.abs(r['1X2'].HOME + r['1X2'].DRAW + r['1X2'].AWAY - 1) < 1e-7);
  const prop = marketConsensus(quotes, { devigMethod: 'proportional' });
  assert.ok(Math.abs(prop['1X2'].AWAY - devig('1X2', set).pFair.AWAY) < 1e-12);
  // Two-way O/U: the shorter side gains, the longer side loses.
  const ou = marketConsensus([q('a', 'OU', 'OVER', 2.5, 1.4), q('a', 'OU', 'UNDER', 2.5, 2.9)]).OU;
  const ouProp = devig('OU', { OVER: 1.4, UNDER: 2.9 }).pFair;
  assert.ok(ou.OVER > ouProp.OVER && ou.UNDER < ouProp.UNDER);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { settlePrediction } = require('../../src/domain/settlement');

const fin = (h, a) => ({ status: 'FINISHED', homeGoals: h, awayGoals: a });
const p = (marketCode, selectionCode, line = null, decimalOdds = 2.5) => ({ marketCode, selectionCode, line, decimalOdds });
const res = (pred, fx) => settlePrediction(pred, fx)?.result;

test('1X2, DC, O/U and BTTS settle on the full-time score; profit is odds − 1 or −1', () => {
  assert.deepEqual(settlePrediction(p('1X2', 'HOME'), fin(2, 1)), { result: 'WIN', profit: 1.5 });
  assert.deepEqual(settlePrediction(p('1X2', 'DRAW'), fin(2, 1)), { result: 'LOSS', profit: -1 });
  assert.equal(res(p('1X2', 'DRAW'), fin(1, 1)), 'WIN');
  assert.equal(res(p('1X2', 'AWAY'), fin(0, 3)), 'WIN');
  assert.equal(res(p('DC', '1X'), fin(1, 1)), 'WIN');
  assert.equal(res(p('DC', '1X'), fin(0, 1)), 'LOSS');
  assert.equal(res(p('DC', '12'), fin(1, 1)), 'LOSS');
  assert.equal(res(p('DC', 'X2'), fin(0, 0)), 'WIN');
  assert.equal(res(p('OU', 'OVER', 2.5), fin(2, 1)), 'WIN');
  assert.equal(res(p('OU', 'UNDER', 2.5), fin(2, 1)), 'LOSS');
  assert.equal(res(p('OU', 'UNDER', 1.5), fin(1, 0)), 'WIN');
  assert.equal(res(p('OU', 'OVER', 3.5), fin(2, 2)), 'WIN');
  assert.equal(res(p('BTTS', 'YES'), fin(1, 1)), 'WIN');
  assert.equal(res(p('BTTS', 'NO'), fin(3, 0)), 'WIN');
  assert.equal(res(p('BTTS', 'NO'), fin(1, 2)), 'LOSS');
});

test('Draw No Bet: a draw is a PUSH with zero profit (CLAUDE.md §6)', () => {
  assert.deepEqual(settlePrediction(p('DNB', 'HOME', null, 1.8), fin(1, 1)), { result: 'PUSH', profit: 0 });
  assert.ok(Math.abs(settlePrediction(p('DNB', 'HOME', null, 1.8), fin(2, 0)).profit - 0.8) < 1e-12);
  assert.equal(res(p('DNB', 'AWAY'), fin(2, 0)), 'LOSS');
});

test('VOID for cancelled/awarded fixtures and for predictions without a priced quote; nothing for unfinished', () => {
  assert.deepEqual(settlePrediction(p('1X2', 'HOME'), { status: 'CANCELLED', homeGoals: null, awayGoals: null }), { result: 'VOID', profit: null });
  assert.deepEqual(settlePrediction(p('1X2', 'HOME'), { status: 'AWARDED', homeGoals: 3, awayGoals: 0 }), { result: 'VOID', profit: null });
  assert.deepEqual(settlePrediction(p('BTTS', 'YES', null, null), fin(1, 1)), { result: 'VOID', profit: null });
  assert.equal(settlePrediction(p('1X2', 'HOME'), { status: 'POSTPONED', homeGoals: null, awayGoals: null }), null);
  assert.equal(settlePrediction(p('1X2', 'HOME'), { status: 'SCHEDULED', homeGoals: null, awayGoals: null }), null);
  assert.equal(settlePrediction(p('1X2', 'HOME'), { status: 'FINISHED', homeGoals: null, awayGoals: null }), null);
});

test('out-of-scope lines and unknown selections are rejected, not guessed', () => {
  assert.throws(() => settlePrediction(p('OU', 'OVER', 2), fin(1, 1)), /line/);
  assert.throws(() => settlePrediction(p('1X2', 'X'), fin(1, 1)), /selection/);
});

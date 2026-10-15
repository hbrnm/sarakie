'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zonedTimeToUtc } = require('../../src/time/zone');
const { isValidDecimalOdds, isValidSelection } = require('../../src/domain/markets');
const { COMPETITIONS, getCompetition } = require('../../src/domain/competitions');

test('zonedTimeToUtc handles DST transitions in Europe/London', () => {
  assert.equal(zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 0, minute: 30 }, 'Europe/London').toISOString(), '2026-03-29T00:30:00.000Z');
  assert.equal(zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 3, minute: 0 }, 'Europe/London').toISOString(), '2026-03-29T02:00:00.000Z');
  // 25 Oct 2026, 01:30 occurs twice; the first occurrence (BST) is used.
  assert.equal(zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, 'Europe/London').toISOString(), '2026-10-25T00:30:00.000Z');
});

test('odds and selection validity', () => {
  for (const bad of [1, 1.0, 0, -2, NaN, Infinity, '2.0', null, 1001]) assert.equal(isValidDecimalOdds(bad), false, String(bad));
  assert.equal(isValidDecimalOdds(1.01), true);
  assert.equal(isValidSelection('OU', 'OVER', 2.5), true);
  assert.equal(isValidSelection('OU', 'OVER', 2.75), false);
  assert.equal(isValidSelection('1X2', 'HOME', null), true);
  assert.equal(isValidSelection('1X2', 'HOME', 2.5), false);
  assert.equal(isValidSelection('DC', 'X2', null), true);
});

test('competition catalog: UEFA competitions are not model-applicable (D-13)', () => {
  assert.equal(COMPETITIONS.length, 7);
  assert.equal(getCompetition('UCL').modelApplicable, false);
  assert.equal(getCompetition('EPL').modelApplicable, true);
  assert.throws(() => getCompetition('XYZ'));
});

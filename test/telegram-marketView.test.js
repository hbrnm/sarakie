'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { marketViewLines, CUP_NOTE } = require('../src/telegram/marketView');

const event = { competitionCode: 'UEL', kickoffUtc: '2026-10-15T19:00:00Z', homeTeamName: 'Benfica', awayTeamName: 'Celtic' };
const consensus = (capturedAt) => ({ '1X2': { HOME: 0.777, DRAW: 0.139, AWAY: 0.084, books: 20 }, OU: { line: 2.5, OVER: 0.702, UNDER: 0.298, books: 20 }, latestCapturedAt: capturedAt });

test('D-26: odds captured 3 h or more before kickoff are flagged as possibly moved', () => {
  const [, morning] = marketViewLines({ event, consensus: consensus('2026-10-15T08:37:00Z') });
  assert.equal(morning, '  piață: 1 77.7% · X 13.9% · 2 8.4% · Peste 2.5 70.2% (20 case, cote de la 11:37, cu 10 h înainte de start: se pot fi mișcat)');
  const [, recent] = marketViewLines({ event, consensus: consensus('2026-10-15T17:30:00Z') });
  assert.equal(recent, '  piață: 1 77.7% · X 13.9% · 2 8.4% · Peste 2.5 70.2% (20 case, cote de la 20:30)');
  assert.match(CUP_NOTE, /fără marjă, metoda puterii/);
});

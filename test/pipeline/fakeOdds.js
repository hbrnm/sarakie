'use strict';

const { NOW, FIXTURE, EST, quote } = require('../risk/helpers');

/** A complete book for every in-scope market at model-fair prices with a margin. */
function fullBook(key, capturedAt, margin = 0.05) {
  const m = EST.markets;
  const out = [];
  const add = (market, sel, line, fair) => out.push(quote(key, market, sel, line, Math.round((fair / (1 + margin)) * 100) / 100, { capturedAt }));
  for (const s of ['HOME', 'DRAW', 'AWAY']) add('1X2', s, null, 1 / m['1X2'][s].p);
  for (const s of ['1X', '12', 'X2']) add('DC', s, null, 1 / m.DC[s].p);
  for (const s of ['HOME', 'AWAY']) add('DNB', s, null, m.DNB[s].fairOdds);
  for (const line of [1.5, 2.5, 3.5]) for (const s of ['OVER', 'UNDER']) add('OU', s, line, 1 / m.OU[line][s].p);
  for (const s of ['YES', 'NO']) add('BTTS', s, null, 1 / m.BTTS[s].p);
  return out.map((q) => ({ ...q, providerEventId: 'ev-od', competitionCode: 'EPL', kickoffUtc: FIXTURE.kickoffUtc, homeTeamName: 'Home FC', awayTeamName: 'Team T02' }));
}

/**
 * Odds API double. `gate` (a promise) holds every event-odds call until it resolves, to
 * simulate a slow provider; `calls.eventOdds` counts the credit-consuming calls.
 */
function fakeOdds({ fail = null, gate = null } = {}) {
  const calls = { events: 0, eventOdds: [] };
  return {
    calls,
    source: 'the_odds_api',
    async listEvents() {
      calls.events += 1;
      return { events: [{ providerEventId: 'ev-od', competitionCode: 'EPL', kickoffUtc: FIXTURE.kickoffUtc, homeTeamName: 'Home FC', awayTeamName: 'Team T02' }], credits: { last: 0 } };
    },
    async getEventOdds(args) {
      calls.eventOdds.push(args);
      if (fail) throw fail;
      if (gate) await gate;
      await new Promise((r) => setImmediate(r));
      const quotes = ['b1', 'b2', 'b3'].flatMap((k) => fullBook(k, NOW.toISOString()));
      return { quotes, events: [{ providerEventId: 'ev-od', competitionCode: 'EPL', kickoffUtc: FIXTURE.kickoffUtc, homeTeamName: 'Home FC', awayTeamName: 'Team T02' }], credits: { last: 6, remaining: 400 } };
    },
  };
}

module.exports = { fullBook, fakeOdds };

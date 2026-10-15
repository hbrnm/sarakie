'use strict';

const { estimate } = require('../../src/domain/model/estimate');
const { syntheticLeague } = require('../model/synthetic');

const L = syntheticLeague({ teams: 20, seasons: 2, seed: 7 });
const lastMs = Date.parse(L.lastKickoff);
const NOW = new Date(lastMs + 6 * 86400000);
const FIXTURE = {
  competitionCode: 'EPL', season: 2025, kickoffUtc: new Date(lastMs + 7 * 86400000).toISOString(),
  homeTeamId: 'T01', awayTeamId: 'T02', status: 'SCHEDULED',
};
const EST = estimate({ fixture: FIXTURE, history: L.matches, asOf: NOW.toISOString() });

/** A quote at fair model odds × factor (factor > 1 gives positive EV). */
function quote(bookmakerKey, marketCode, selectionCode, line, decimalOdds, over = {}) {
  return {
    sourceProvider: 'the_odds_api', providerEventId: 'ev1', bookmakerKey, bookmakerName: bookmakerKey.toUpperCase(),
    marketCode, selectionCode, line, decimalOdds, capturedAt: new Date(NOW.getTime() - 30 * 60000).toISOString(),
    sourceTimestamp: null, kind: 'pre_match', ...over,
  };
}

/** Book with margin `m` on model-fair prices, optionally boosting one selection. */
function book(bookmakerKey, { margin = 0.05, boost = null } = {}) {
  const fair = (p) => 1 / p;
  const out = [];
  const add = (market, sel, line, p) => {
    let o = fair(p) / (1 + margin);
    if (boost && boost.market === market && boost.sel === sel && (boost.line ?? null) === line) o *= boost.factor;
    out.push(quote(bookmakerKey, market, sel, line, Math.round(o * 100) / 100));
  };
  const m = EST.markets;
  for (const s of ['HOME', 'DRAW', 'AWAY']) add('1X2', s, null, m['1X2'][s].p);
  for (const line of [1.5, 2.5, 3.5]) for (const s of ['OVER', 'UNDER']) add('OU', s, line, m.OU[line][s].p);
  return out;
}

module.exports = { L, NOW, FIXTURE, EST, quote, book };

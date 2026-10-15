'use strict';

const { devig } = require('./index');

/**
 * Market-only view (D-19): consensus de-vigged probabilities across bookmakers, used for
 * UCL/UEL matches where the model is not applicable (D-13). No model, no EV, no status.
 *
 * Per bookmaker, the latest quote of each selection is taken; a market counts only when
 * that bookmaker's set is complete (CLAUDE.md §6). The consensus is the plain mean of the
 * per-bookmaker de-vigged probabilities. Deterministic: order of quotes does not matter.
 *
 * @param {import('../types').OddsQuote[]} quotes quotes of one event
 * @param {{ ouLine?: number }} [options]
 * @returns {{ '1X2': { HOME: number, DRAW: number, AWAY: number, books: number } | null, OU: { line: number, OVER: number, UNDER: number, books: number } | null, latestCapturedAt: string | null }}
 */
function marketConsensus(quotes, { ouLine = 2.5 } = {}) {
  const latest = new Map();
  for (const q of quotes) {
    if (q.kind && q.kind !== 'pre_match') continue;
    const k = `${q.bookmakerKey}|${q.marketCode}|${q.selectionCode}|${q.line ?? ''}`;
    const cur = latest.get(k);
    if (!cur || Date.parse(q.capturedAt) > Date.parse(cur.capturedAt)) latest.set(k, q);
  }
  const books = [...new Set([...latest.values()].map((q) => q.bookmakerKey))].sort();
  const odds = (b, m, s, l = null) => {
    const q = latest.get(`${b}|${m}|${s}|${l ?? ''}`);
    return q ? q.decimalOdds : undefined;
  };

  const mean = (marketCode, selections, line) => {
    const fair = [];
    for (const b of books) {
      const r = devig(marketCode, Object.fromEntries(selections.map((s) => [s, odds(b, marketCode, s, line)])));
      if (r.complete) fair.push(r.pFair);
    }
    if (!fair.length) return null;
    const out = Object.fromEntries(selections.map((s) => [s, fair.reduce((acc, p) => acc + p[s], 0) / fair.length]));
    return { ...out, books: fair.length };
  };

  const captured = [...latest.values()].map((q) => q.capturedAt).sort();
  const ou = mean('OU', ['OVER', 'UNDER'], ouLine);
  return {
    '1X2': mean('1X2', ['HOME', 'DRAW', 'AWAY'], null),
    OU: ou ? { line: ouLine, ...ou } : null,
    latestCapturedAt: captured.length ? captured[captured.length - 1] : null,
  };
}

module.exports = { marketConsensus };

'use strict';

const { meanCi } = require('./index');

const MIN_SETTLED = 150;
const MIN_WEEKS = 6;
const WEEK = 7 * 86400000;

/**
 * Paper-test summary per scope (docs/23 §5). Each fixture selection counts once per scope:
 * its first LINE_VALUE row (the moment the price would have been taken). Pure.
 *
 * @param {{ id: number, fixtureId: string, scope: string, selectionCode: string, createdAt: string, outcome: { result: string, clv: number|null, closeEv: number|null, profit: number|null } | null }[]} candidates
 * @param {{ now: Date }} options
 */
function lineReport(candidates, { now }) {
  const first = new Map();
  for (const c of [...candidates].sort((a, b) => a.id - b.id)) {
    const k = `${c.scope}|${c.fixtureId}|${c.selectionCode}`;
    if (!first.has(k)) first.set(k, c);
  }
  const startMs = candidates.length ? Math.min(...candidates.map((c) => Date.parse(c.createdAt))) : null;
  const weeks = startMs === null ? 0 : (now.getTime() - startMs) / WEEK;
  const scopes = {};
  for (const scope of ['all', 'playable']) {
    const list = [...first.values()].filter((c) => c.scope === scope);
    const settled = list.filter((c) => c.outcome && c.outcome.result !== 'VOID');
    const closed = settled.filter((c) => c.outcome.closeEv !== null);
    const profit = settled.reduce((a, c) => a + c.outcome.profit, 0);
    const clv = meanCi(closed.map((c) => c.outcome.clv));
    const closeEv = meanCi(closed.map((c) => c.outcome.closeEv));
    let verdict = 'IN_PROGRESS';
    if (closed.length >= MIN_SETTLED && weeks >= MIN_WEEKS) {
      if (closeEv.mean <= 0) verdict = 'STOP';
      else if (closeEv.low > 0 && clv.mean > 0) verdict = 'EDGE_CONFIRMED';
      else verdict = 'EXTEND';
    }
    scopes[scope] = {
      candidates: list.length,
      pending: list.filter((c) => !c.outcome).length,
      settled: settled.length,
      withClosing: closed.length,
      wins: settled.filter((c) => c.outcome.result === 'WIN').length,
      roi: settled.length ? profit / settled.length : null,
      clv,
      closeEv,
      verdict,
    };
  }
  return { startedAt: startMs === null ? null : new Date(startMs).toISOString(), weeks, minSettled: MIN_SETTLED, minWeeks: MIN_WEEKS, scopes };
}

module.exports = { lineReport, MIN_SETTLED, MIN_WEEKS };

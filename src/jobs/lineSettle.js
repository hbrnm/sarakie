'use strict';

const { settleLineCandidate } = require('../domain/lineShopping');

const DAY = 86400000;

/**
 * Paper settlement of line candidates (Phase 6d, docs/23 §3). A finished fixture is settled
 * once Pinnacle closing odds from football-data.co.uk are stored for it (imported by the same
 * workflow step), so CLV and close-EV are recorded with the result. If the closing odds are
 * still missing `closingWaitDays` after kickoff, the candidate is settled without them
 * (CLV null). Cancelled or awarded fixtures are VOID at once. The close is de-vigged with the
 * method of the candidate's rule version (docs/23 §9). Append-only and idempotent.
 *
 * @param {{
 *   store: ReturnType<typeof import('../persistence/analysisStore').createAnalysisStore>,
 *   now?: () => Date,
 *   closingWaitDays?: number,
 * }} deps
 */
async function lineSettle({ store, now = () => new Date(), closingWaitDays = 10 }) {
  const t = now();
  const pending = await store.unsettledLineCandidates();
  const closing = await store.pinnacleClosing(pending.map((p) => p.fixtureId));
  const rows = [];
  const report = { pending: pending.length, settled: 0, withClosing: 0, waitingForClosing: 0, counts: { WIN: 0, LOSS: 0, VOID: 0 } };
  for (const p of pending) {
    const close = closing.get(p.fixtureId) || null;
    const final = p.fixture.status === 'FINISHED';
    if (final && !close && t.getTime() - Date.parse(p.fixture.kickoffUtc) < closingWaitDays * DAY) {
      report.waitingForClosing += 1;
      continue;
    }
    const r = settleLineCandidate(p, p.fixture, close);
    if (!r) continue;
    report.counts[r.result] += 1;
    if (r.clv !== null) report.withClosing += 1;
    rows.push({
      candidate_id: p.candidateId,
      settled_at: t.toISOString(),
      result: r.result,
      home_goals: p.fixture.homeGoals,
      away_goals: p.fixture.awayGoals,
      close_snapshot_id: r.clv !== null ? close.snapshotIds[p.selectionCode] ?? null : null,
      pin_close_odds: r.closeOdds,
      p_pin_close: r.pClose,
      clv: r.clv,
      close_ev: r.closeEv,
      profit_per_unit: r.profit,
    });
  }
  await store.insertLineOutcomes(rows);
  report.settled = rows.length;
  return report;
}

module.exports = { lineSettle };

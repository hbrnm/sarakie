'use strict';

const { clusterMeanCi } = require('./index');
const { LINE_RULE_VERSION } = require('./config');

const MIN_SETTLED = 150;
// D-25 (PO, 2026-10-15): the 150 candidates must also come from at least 75 distinct fixtures.
const MIN_FIXTURES = 75;
const MIN_WEEKS = 6;
const WEEK = 7 * 86400000;
const HOUR = 3600000;

/**
 * Time from the candidate row (the daily capture) to kickoff, in buckets (docs/23 §9):
 * `lt12` < 12 h, `h12to48` 12–48 h, `other` anything else (or unknown).
 */
const LEAD_BUCKETS = Object.freeze(['lt12', 'h12to48', 'other']);
function leadBucket(c) {
  const h = (Date.parse(c.kickoffUtc) - Date.parse(c.createdAt)) / HOUR;
  if (!Number.isFinite(h) || h < 0) return 'other';
  if (h < 12) return 'lt12';
  return h <= 48 ? 'h12to48' : 'other';
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Paper-test summary per scope (docs/23 §5, §9). Only candidates of the current rule version
 * count (earlier versions are reported as a count). Each fixture selection counts once per
 * scope: its first LINE_VALUE row (the moment the price would have been taken). Confidence
 * intervals are clustered by fixture. Pure.
 *
 * @param {{ id: number, ruleVersion?: string, fixtureId: string, scope: string, selectionCode: string, kickoffUtc?: string, createdAt: string, outcome: { result: string, clv: number|null, closeEv: number|null, profit: number|null } | null }[]} candidates
 * @param {{ now: Date, ruleVersion?: string }} options
 */
function lineReport(candidates, { now, ruleVersion = LINE_RULE_VERSION }) {
  const current = candidates.filter((c) => (c.ruleVersion ?? ruleVersion) === ruleVersion);
  const first = new Map();
  for (const c of [...current].sort((a, b) => a.id - b.id)) {
    const k = `${c.scope}|${c.fixtureId}|${c.selectionCode}`;
    if (!first.has(k)) first.set(k, c);
  }
  const startMs = current.length ? Math.min(...current.map((c) => Date.parse(c.createdAt))) : null;
  const weeks = startMs === null ? 0 : (now.getTime() - startMs) / WEEK;
  const scopes = {};
  for (const scope of ['all', 'playable']) {
    const list = [...first.values()].filter((c) => c.scope === scope);
    const settled = list.filter((c) => c.outcome && c.outcome.result !== 'VOID');
    const closed = settled.filter((c) => c.outcome.closeEv !== null);
    const profit = settled.reduce((a, c) => a + c.outcome.profit, 0);
    const clv = clusterMeanCi(closed.map((c) => ({ value: c.outcome.clv, cluster: c.fixtureId })));
    const closeEv = clusterMeanCi(closed.map((c) => ({ value: c.outcome.closeEv, cluster: c.fixtureId })));
    let verdict = 'IN_PROGRESS';
    const fixturesWithClosing = new Set(closed.map((c) => c.fixtureId)).size;
    if (closed.length >= MIN_SETTLED && fixturesWithClosing >= MIN_FIXTURES && weeks >= MIN_WEEKS) {
      if (closeEv.mean <= 0) verdict = 'STOP';
      else if (closeEv.low !== null && closeEv.low > 0 && clv.mean > 0) verdict = 'EDGE_CONFIRMED';
      else verdict = 'EXTEND';
    }
    const byLead = {};
    for (const b of LEAD_BUCKETS) {
      const inB = closed.filter((c) => leadBucket(c) === b);
      byLead[b] = {
        candidates: inB.length,
        fixtures: new Set(inB.map((c) => c.fixtureId)).size,
        clv: mean(inB.map((c) => c.outcome.clv)),
        closeEv: mean(inB.map((c) => c.outcome.closeEv)),
      };
    }
    scopes[scope] = {
      candidates: list.length,
      pending: list.filter((c) => !c.outcome).length,
      settled: settled.length,
      withClosing: closed.length, // N_candidates
      fixturesWithClosing, // N_fixtures
      wins: settled.filter((c) => c.outcome.result === 'WIN').length,
      roi: settled.length ? profit / settled.length : null,
      clv,
      closeEv,
      byLead,
      verdict,
    };
  }
  return {
    ruleVersion,
    otherVersionRows: candidates.length - current.length,
    startedAt: startMs === null ? null : new Date(startMs).toISOString(),
    weeks,
    minSettled: MIN_SETTLED,
    minFixtures: MIN_FIXTURES,
    minWeeks: MIN_WEEKS,
    scopes,
  };
}

module.exports = { lineReport, leadBucket, LEAD_BUCKETS, MIN_SETTLED, MIN_FIXTURES, MIN_WEEKS };

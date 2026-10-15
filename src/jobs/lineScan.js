'use strict';

const { evaluateLineShopping } = require('../domain/lineShopping');
const { LINE_RULE_VERSION, defaultLineConfig, lineConfigHash } = require('../domain/lineShopping/config');

/**
 * Line-shopping scan (Phase 6d, docs/23 §4). Evaluates the 1X2 odds captured in the same run
 * for each fixture and appends every evaluated selection to `line_candidates` (both scopes).
 * Uses no odds credits. Shared by the scanner and /analyze (CLAUDE.md §4.5); only the
 * scanner records rows, so the paper test counts each daily capture once.
 *
 * @param {{
 *   store: ReturnType<typeof import('../persistence/analysisStore').createAnalysisStore>,
 *   runId: string,
 *   fixtures: { id: string, kickoffUtc: string }[],
 *   now: Date,
 *   config?: ReturnType<typeof defaultLineConfig>,
 *   logger?: object | null,
 * }} deps
 * @returns {Promise<{ evaluated: number, inserted: number, failed: number, results: { fixture: object, selections: object[] }[] }>}
 */
async function lineScan({ store, runId, fixtures, now, config = defaultLineConfig(), logger = null }) {
  const hash = lineConfigHash(config);
  const since = new Date(now.getTime() - config.maxOddsAgeMinutes * 60000);
  const report = { evaluated: 0, inserted: 0, failed: 0, results: [] };
  const rows = [];
  for (const fixture of fixtures) {
    try {
      const quotes = await store.loadQuotes({ fixtureId: fixture.id, since });
      const { selections } = evaluateLineShopping({ quotes, kickoffUtc: fixture.kickoffUtc, now, config });
      report.evaluated += 1;
      report.results.push({ fixture, selections });
      for (const s of selections) {
        rows.push({
          analysis_run_id: runId,
          fixture_id: fixture.id,
          kickoff_utc: fixture.kickoffUtc,
          rule_version: LINE_RULE_VERSION,
          rule_config_hash: hash,
          scope: s.scope,
          market_code: s.marketCode,
          selection_code: s.selectionCode,
          pin_snapshot_id: s.pinSnapshotId,
          pin_odds: s.pinOdds,
          p_pin: s.pPin,
          pin_overround: s.pinOverround,
          pin_captured_at: s.pinCapturedAt,
          price_snapshot_id: s.priceSnapshotId,
          bookmaker_key: s.bookmakerKey,
          price: s.price,
          median_price: s.medianPrice,
          n_prices: s.nPrices,
          edge: s.edge,
          status: s.status,
          reason_codes: s.reasonCodes,
          created_at: now.toISOString(),
        });
      }
    } catch (err) {
      report.failed += 1;
      if (logger) logger.error('line_scan.fixture_failed', { fixtureId: fixture.id, error: err && err.message });
    }
  }
  report.inserted = await store.insertLineCandidates(rows);
  return report;
}

module.exports = { lineScan };

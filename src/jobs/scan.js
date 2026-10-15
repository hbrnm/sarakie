'use strict';

const { COMPETITIONS, getCompetition } = require('../domain/competitions');
const { MODEL_FAMILY, MODEL_VERSION, defaultConfig, configHash } = require('../domain/model/config');
const { RISK_VERSION, defaultRiskConfig, riskConfigHash } = require('../domain/risk/config');
const { analyzeFixture, SCANNER_MARKETS } = require('../pipeline/analyzeFixture');
const { recordAnalysis } = require('../pipeline/record');
const { buildDigest } = require('../telegram/digest');
const { bucharestDate, formatKickoff } = require('../time/format');
const { marketConsensus } = require('../domain/odds/consensus');
const { lineScan } = require('./lineScan');

const DOMESTIC = COMPETITIONS.filter((c) => c.modelApplicable).map((c) => c.code);
const CUPS = COMPETITIONS.filter((c) => !c.modelApplicable).map((c) => c.code); // UCL/UEL: market view only (D-13, D-19)
const QUOTE_LOOKBACK_MS = 24 * 3600 * 1000;

/**
 * Daily scanner (Phase 5.2). Runs right after daily-sync in the same workflow, so it
 * evaluates the odds captured in that run (option A, ≤ 6 h).
 *
 * Idempotent per Europe/Bucharest day: every run analyses and records (unchanged inputs
 * record nothing, see recordAnalysis), but only the first run of the day stores and sends
 * a digest (scan_digests primary key). A send failure leaves the digest stored; /scan
 * re-sends it.
 *
 * @param {{
 *   store: ReturnType<typeof import('../persistence/analysisStore').createAnalysisStore>,
 *   sender?: { send: (chatId: number, text: string) => Promise<void> } | null,
 *   chatIds?: number[],
 *   usage?: () => Promise<object>,
 *   now?: () => Date,
 *   horizonHours?: number,
 *   logger?: object | null,
 * }} deps
 */
async function scan({ store, sender = null, chatIds = [], usage = null, now = () => new Date(), horizonHours = 48, logger = null }) {
  const t0 = now();
  const scanDate = bucharestDate(t0);
  const modelConfig = defaultConfig();
  const riskConfig = defaultRiskConfig();
  const modelVersionId = await store.ensureModelVersion({ modelFamily: MODEL_FAMILY, modelVersion: MODEL_VERSION, config: modelConfig, configHash: configHash(modelConfig) });
  const runId = await store.startRun({ trigger: 'scanner', scanDate, asOf: t0, modelVersionId, riskVersion: RISK_VERSION, riskConfigHash: riskConfigHash(riskConfig) });
  const report = { scanDate, runId, considered: 0, analyzed: 0, recorded: 0, failed: 0, digest: null, sent: 0, sendErrors: 0, line: null };

  try {
    const fixtures = await store.upcomingFixtures({ from: t0, to: new Date(t0.getTime() + horizonHours * 3600000), competitionCodes: DOMESTIC });
    report.considered = fixtures.length;
    const history = new Map();
    const results = [];
    for (const fixture of fixtures) {
      try {
        if (!history.has(fixture.competitionCode)) history.set(fixture.competitionCode, await store.loadHistory({ competitionCode: fixture.competitionCode, before: t0 }));
        const result = await analyzeFixture(
          { fixture, mode: 'scanner', now: t0, fetchedMarkets: SCANNER_MARKETS, history: history.get(fixture.competitionCode), explain: false },
          { store, logger },
        );
        results.push(result);
        report.analyzed += 1;
        if ((await recordAnalysis(store, { runId, modelVersionId, result })).recorded) report.recorded += 1;
      } catch (err) {
        report.failed += 1;
        if (logger) logger.error('scan.fixture_failed', { fixtureId: fixture.id, error: err && err.message });
      }
    }

    // D-24 (Phase 6d): line shopping on the same fixtures and the odds of this run; 0 credits.
    let lineResults = [];
    try {
      const line = await lineScan({ store, runId, fixtures, now: t0, logger });
      report.line = { evaluated: line.evaluated, inserted: line.inserted, failed: line.failed };
      const matchOf = new Map(results.map((r) => [r.fixture.id, r.match]));
      for (const r of line.results) {
        const m = matchOf.get(r.fixture.id) || {
          home: await store.teamName(r.fixture.homeTeamId),
          away: await store.teamName(r.fixture.awayTeamId),
          competition: getCompetition(r.fixture.competitionCode).name,
          kickoff: formatKickoff(new Date(r.fixture.kickoffUtc)),
        };
        lineResults.push({ ...r, match: `${m.home} – ${m.away}`, kickoff: m.kickoff });
      }
    } catch (err) {
      report.line = { error: err.message };
      lineResults = [];
      if (logger) logger.error('scan.line_failed', { error: err && err.message });
    }

    // D-19: cup matches get a market-only view (no model, no predictions recorded).
    const cups = [];
    try {
      const events = await store.upcomingOddsEvents({ from: t0, to: new Date(t0.getTime() + horizonHours * 3600000), competitionCodes: CUPS });
      const quotes = await store.loadEventQuotes({ eventIds: events.map((e) => e.providerEventId), since: new Date(t0.getTime() - QUOTE_LOOKBACK_MS) });
      for (const event of events) {
        const consensus = marketConsensus(quotes.filter((q) => q.providerEventId === event.providerEventId));
        if (consensus['1X2'] || consensus.OU) cups.push({ event, consensus });
      }
      report.cups = cups.length;
    } catch (err) {
      if (logger) logger.error('scan.cups_failed', { error: err && err.message });
    }

    const existing = await store.getDigest(scanDate);
    if (existing) {
      report.digest = 'ALREADY_EXISTS';
    } else {
      const text = buildDigest({
        scanDate, horizonHours, results, failed: report.failed, cups, lineResults,
        usage: usage ? await usage().catch(() => null) : null,
        modelVersion: MODEL_VERSION, riskVersion: RISK_VERSION,
      });
      if (await store.insertDigest({ scanDate, runId, text })) {
        report.digest = 'CREATED';
        for (const chatId of chatIds) {
          try {
            await sender.send(chatId, text);
            report.sent += 1;
          } catch (err) {
            report.sendErrors += 1;
            if (logger) logger.error('scan.send_failed', { error: err && err.message });
          }
        }
      } else {
        report.digest = 'ALREADY_EXISTS';
      }
    }

    const problems = [
      report.failed ? `${report.failed} fixture(s) failed` : null,
      report.line && (report.line.error || report.line.failed) ? `line scan: ${report.line.error || `${report.line.failed} fixture(s) failed`}` : null,
      report.sendErrors ? `${report.sendErrors} Telegram send(s) failed` : null,
    ].filter(Boolean);
    await store.finishRun(runId, {
      status: problems.length ? 'PARTIAL' : 'OK',
      finishedAt: now(),
      counts: { considered: report.considered, analyzed: report.analyzed, recorded: report.recorded },
      errorSummary: problems.join('; ') || null,
    });
    report.status = problems.length ? 'PARTIAL' : 'OK';
  } catch (err) {
    await store.finishRun(runId, { status: 'FAILED', finishedAt: now(), counts: report, errorSummary: `${err.code || 'ERROR'}: ${err.message}` }).catch(() => {});
    throw err;
  }
  return report;
}

/**
 * Missed-run detection (docs/09 §3): if no successful scanner run exists for today's
 * Europe/Bucharest date, alert the allowlisted users. Run by a later cron.
 */
async function scanWatchdog({ store, sender, chatIds, now = () => new Date() }) {
  const scanDate = bucharestDate(now());
  const runs = await store.successfulScans(scanDate);
  if (runs.length) return { scanDate, ok: true };
  const text = `⚠️ FVIS: scanerul zilnic nu a rulat cu succes azi (${scanDate}). Verifică GitHub Actions → daily-sync; poate fi pornit manual (Run workflow).`;
  for (const chatId of chatIds) await sender.send(chatId, text);
  return { scanDate, ok: false, alerted: chatIds.length };
}

module.exports = { scan, scanWatchdog, DOMESTIC, CUPS };

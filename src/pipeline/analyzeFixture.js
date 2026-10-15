'use strict';

const crypto = require('node:crypto');
const { estimate } = require('../domain/model/estimate');
const { canonicalJson } = require('../domain/model/config');
const { evaluateFixture } = require('../domain/risk/evaluate');
const { getCompetition } = require('../domain/competitions');
const { explainAnalysis } = require('../explain');
const { formatKickoff } = require('../time/format');

const ALL_MARKETS = Object.freeze(['1X2', 'DC', 'DNB', 'OU', 'BTTS']);
const SCANNER_MARKETS = Object.freeze(['1X2', 'OU']); // D-11: featured odds only
const QUOTE_LOOKBACK_MS = 24 * 3600 * 1000; // older quotes are stale in both modes anyway

/**
 * Hash of everything that determines a recorded result: model and risk configuration,
 * model inputs (via λ and the data cutoff) and, per selection, status, reasons and the
 * exact quote. Identical hash ⇒ re-recording would only duplicate rows.
 */
function inputHash({ fixture, est, evaluation }) {
  const payload = {
    fixtureId: fixture.id,
    kickoffUtc: fixture.kickoffUtc,
    fixtureStatus: fixture.status,
    modelConfigHash: evaluation.modelConfigHash,
    riskConfigHash: evaluation.riskConfigHash,
    estimate: { status: est.status, reasons: est.reasons, lambdas: est.lambdas ?? null, dataCutoffUtc: est.diagnostics.dataCutoffUtc ?? null, leagueSample: est.diagnostics.leagueSample ?? null },
    selections: evaluation.selections.map((s) => [s.marketCode, s.selectionCode, s.line, s.status, s.reasonCodes, s.bestQuote ? [s.bestQuote.snapshotId, s.bestQuote.decimalOdds] : null]),
  };
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * The single analysis pipeline shared by the daily scanner and on-demand analysis
 * (CLAUDE.md §4.5): history → estimate → odds → risk evaluation → explanation.
 * No numbers are computed here; the domain modules do all calculations.
 *
 * @param {{
 *   fixture: { id: string, competitionCode: string, season: number, kickoffUtc: string, status: string, homeTeamId: string, awayTeamId: string },
 *   mode: 'scanner' | 'on_demand',
 *   now: Date,
 *   fetchedMarkets?: string[],     markets whose odds were requested (D-11); default by mode
 *   history?: object[],            preloaded history for the competition (scanner cache)
 *   explain?: boolean,
 * }} input
 * @param {{ store: ReturnType<typeof import('../persistence/analysisStore').createAnalysisStore>, gemini?: object|null, logger?: object|null }} deps
 */
async function analyzeFixture({ fixture, mode, now, fetchedMarkets, history, explain = true }, { store, gemini = null, logger = null }) {
  const kickoffMs = Date.parse(fixture.kickoffUtc);
  // A fixture that already kicked off is analysed as of its kickoff (risk gates reject it anyway).
  const asOf = new Date(Math.min(now.getTime(), kickoffMs));
  const hist = history || (await store.loadHistory({ competitionCode: fixture.competitionCode, before: asOf }));
  const est = estimate({ fixture, history: hist, asOf: asOf.toISOString() });
  const quotes = await store.loadQuotes({ fixtureId: fixture.id, since: new Date(now.getTime() - QUOTE_LOOKBACK_MS) });
  const evaluation = evaluateFixture({
    fixture,
    estimate: est,
    quotes,
    fetchedMarkets: fetchedMarkets || (mode === 'scanner' ? SCANNER_MARKETS : ALL_MARKETS),
    mode,
    now,
  });
  const match = {
    home: await store.teamName(fixture.homeTeamId),
    away: await store.teamName(fixture.awayTeamId),
    competition: getCompetition(fixture.competitionCode).name,
    kickoff: formatKickoff(new Date(kickoffMs)),
  };
  const explanation = explain ? await explainAnalysis({ match, evaluation, estimate: est, gemini, logger }) : null;
  return { fixture, asOf, match, estimate: est, evaluation, explanation, inputHash: inputHash({ fixture, est, evaluation }), quoteCount: quotes.length };
}

module.exports = { analyzeFixture, inputHash, ALL_MARKETS, SCANNER_MARKETS };

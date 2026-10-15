'use strict';

/**
 * Turns one analysis into append-only `predictions` rows (docs/05-data-dictionary.md):
 * all 16 selections, including INSUFFICIENT_DATA (D-17). Pure; no I/O.
 */
function predictionRows({ runId, modelVersionId, result }) {
  const { fixture, asOf, estimate: est, evaluation, inputHash } = result;
  const diagnostics = est.diagnostics || {};
  return evaluation.selections.map((s) => {
    const m = s.model;
    const isDnb = s.marketCode === 'DNB';
    return {
      analysis_run_id: runId,
      fixture_id: fixture.id,
      model_version_id: modelVersionId,
      risk_version: evaluation.riskVersion,
      risk_config_hash: evaluation.riskConfigHash,
      mode: evaluation.mode,
      input_hash: inputHash,
      as_of: asOf.toISOString(),
      data_cutoff_utc: diagnostics.dataCutoffUtc ?? null,
      market_code: s.marketCode,
      selection_code: s.selectionCode,
      line: s.line,
      lambda_home: est.lambdas ? est.lambdas.home : null,
      lambda_away: est.lambdas ? est.lambdas.away : null,
      p_model: m ? (isDnb ? m.win : m.p) : null,
      p_push: m && isDnb ? m.push : null,
      p_loss: m && isDnb ? m.loss : null,
      fair_odds: m ? m.fairOdds : null,
      odds_snapshot_id: s.bestQuote ? s.bestQuote.snapshotId : null,
      bookmaker_key: s.bestQuote ? s.bestQuote.bookmakerKey : null,
      decimal_odds: s.bestQuote ? s.bestQuote.decimalOdds : null,
      p_raw: s.pRaw ?? null,
      p_devig: s.pDevig ?? null,
      overround: s.overround ?? null,
      ev: s.ev ?? null,
      bookmaker_count: s.bookmakerCount ?? null,
      status: s.status,
      reason_codes: s.reasonCodes,
      notes: s.notes || [],
      diagnostics: { ...diagnostics, estimateStatus: est.status, estimateReasons: est.reasons },
    };
  });
}

/**
 * Records an analysis unless the latest recorded analysis of the fixture has the same
 * input hash (a duplicated or repeated run must not inflate the table). Never updates rows.
 * @returns {Promise<{ recorded: boolean }>}
 */
async function recordAnalysis(store, { runId, modelVersionId, result }) {
  const last = await store.lastInputHash(result.fixture.id);
  if (last === result.inputHash) return { recorded: false };
  await store.insertPredictions(predictionRows({ runId, modelVersionId, result }));
  if (result.explanation) {
    await store.insertExplanation({
      analysis_run_id: runId,
      fixture_id: result.fixture.id,
      generator: result.explanation.generator,
      model_id: result.explanation.modelId ?? null,
      validated: result.explanation.validated,
      rejection_reason: result.explanation.rejectionReason,
      text: result.explanation.text,
    });
  }
  return { recorded: true };
}

module.exports = { predictionRows, recordAnalysis };

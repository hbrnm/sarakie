'use strict';

const { RISK_VERSION, defaultRiskConfig, riskConfigHash } = require('./config');
const { devig, doubleChanceFrom1x2, dnbConditional, expectedValue, expectedValueDnb } = require('../odds');

/**
 * Risk and eligibility classification (docs/06-risk-policy.md, CLAUDE.md §7).
 * Pure and deterministic. Every selection gets exactly one status:
 *   INSUFFICIENT_DATA → NO_VALUE → WATCHLIST → QUALIFIED
 * and the reason codes of ALL failed gates, not only the first one.
 * QUALIFIED means eligible for tracking and paper validation only.
 */

const SELECTIONS = Object.freeze([
  ['1X2', 'HOME', null], ['1X2', 'DRAW', null], ['1X2', 'AWAY', null],
  ['DC', '1X', null], ['DC', '12', null], ['DC', 'X2', null],
  ['DNB', 'HOME', null], ['DNB', 'AWAY', null],
  ['OU', 'OVER', 1.5], ['OU', 'UNDER', 1.5], ['OU', 'OVER', 2.5], ['OU', 'UNDER', 2.5], ['OU', 'OVER', 3.5], ['OU', 'UNDER', 3.5],
  ['BTTS', 'YES', null], ['BTTS', 'NO', null],
]);

const key = (m, s, l) => `${m}|${s}|${l ?? ''}`;

/** Latest quote per (bookmaker, market, selection, line). */
function latestQuotes(quotes) {
  const latest = new Map();
  for (const q of quotes) {
    const k = `${q.bookmakerKey}|${key(q.marketCode, q.selectionCode, q.line)}`;
    const cur = latest.get(k);
    if (!cur || Date.parse(q.capturedAt) > Date.parse(cur.capturedAt)) latest.set(k, q);
  }
  return [...latest.values()];
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Model probability for a selection from a Phase 3 estimate. */
function modelProbability(estimate, marketCode, selectionCode, line) {
  const m = estimate.markets;
  if (marketCode === 'DNB') return m.DNB[selectionCode];
  if (marketCode === 'OU') return m.OU[line] && m.OU[line][selectionCode];
  return m[marketCode][selectionCode];
}

/**
 * @param {{
 *   fixture: { kickoffUtc: string, status: string },
 *   estimate: object,                       Phase 3 estimate() result
 *   quotes: import('../types').OddsQuote[], pre-match quotes for this fixture
 *   fetchedMarkets: string[],               markets whose odds were requested (D-11)
 *   mode: 'scanner' | 'on_demand',
 *   now: Date,
 *   config?: ReturnType<typeof defaultRiskConfig>,
 * }} input
 */
function evaluateFixture({ fixture, estimate, quotes, fetchedMarkets, mode, now, config = defaultRiskConfig() }) {
  if (mode !== 'scanner' && mode !== 'on_demand') throw new Error(`unknown mode: ${mode}`);
  const nowMs = now.getTime();
  const maxAgeMs = (mode === 'scanner' ? config.maxOddsAgeScannerMinutes : config.maxOddsAgeOnDemandMinutes) * 60000;
  const kickoffMs = Date.parse(fixture.kickoffUtc);

  // Fixture-level hard gates.
  const fixtureReasons = [];
  if (estimate.status !== 'OK') fixtureReasons.push(...estimate.reasons);
  if (fixture.status !== 'SCHEDULED' || !(kickoffMs > nowMs)) fixtureReasons.push('FIXTURE_NOT_SCHEDULED');
  else if (kickoffMs - nowMs < config.minLeadTimeMinutes * 60000) fixtureReasons.push('KICKOFF_TOO_CLOSE');

  const fetched = new Set(fetchedMarkets);
  const latest = latestQuotes(quotes.filter((q) => q.kind === undefined || q.kind === 'pre_match'));
  const bySel = new Map();
  for (const q of latest) {
    const k = key(q.marketCode, q.selectionCode, q.line);
    if (!bySel.has(k)) bySel.set(k, []);
    bySel.get(k).push(q);
  }
  const isValid = (q) => typeof q.decimalOdds === 'number' && Number.isFinite(q.decimalOdds) && q.decimalOdds >= config.minOdds && q.decimalOdds <= config.maxOdds;
  const isFresh = (q) =>
    nowMs - Date.parse(q.capturedAt) <= maxAgeMs && (!q.sourceTimestamp || nowMs - Date.parse(q.sourceTimestamp) <= maxAgeMs);
  const freshValid = (m, s, l) => (bySel.get(key(m, s, l)) || []).filter((q) => isValid(q) && isFresh(q));
  const bookOdds = (bookmakerKey, m, s, l) => {
    const q = freshValid(m, s, l).find((x) => x.bookmakerKey === bookmakerKey);
    return q ? q.decimalOdds : undefined;
  };

  const selections = [];
  for (const [marketCode, selectionCode, line] of SELECTIONS) {
    const reasons = [...fixtureReasons];
    const prob = estimate.status === 'OK' ? modelProbability(estimate, marketCode, selectionCode, line) : null;
    const all = bySel.get(key(marketCode, selectionCode, line)) || [];
    if (!fetched.has(marketCode)) reasons.push('ODDS_NOT_FETCHED');
    else if (!all.length) reasons.push('ODDS_MISSING');
    else if (!all.some(isValid)) reasons.push('ODDS_INVALID');
    else if (!all.some((q) => isValid(q) && isFresh(q))) reasons.push('ODDS_STALE');

    const base = { marketCode, selectionCode, line, model: prob };
    if (reasons.length) {
      selections.push({ ...base, status: 'INSUFFICIENT_DATA', reasonCodes: [...new Set(reasons)] });
      continue;
    }

    // Price selection: best odds among quotes near the cross-book consensus.
    const fresh = freshValid(marketCode, selectionCode, line);
    const med = median(fresh.map((q) => 1 / q.decimalOdds));
    const consensus = fresh.filter((q) => Math.abs(1 / q.decimalOdds - med) <= config.outlierTol);
    const pick = (list) => [...list].sort((a, b) => b.decimalOdds - a.decimalOdds || (a.bookmakerKey < b.bookmakerKey ? -1 : 1))[0];
    const best = pick(consensus);
    const overallBest = pick(fresh);
    const notes = overallBest.bookmakerKey !== best.bookmakerKey ? ['PRICE_OUTLIER_EXCLUDED'] : [];
    const bookmakerCount = new Set(fresh.map((q) => q.bookmakerKey)).size;

    // Market reference from the chosen bookmaker's complete set (CLAUDE.md §6).
    let market;
    if (marketCode === 'DC') {
      const r = devig('1X2', Object.fromEntries(['HOME', 'DRAW', 'AWAY'].map((s) => [s, bookOdds(best.bookmakerKey, '1X2', s, null)])));
      market = r.complete ? { pDevig: doubleChanceFrom1x2(r.pFair)[selectionCode], overround: r.overround } : { reason: r.reason };
    } else {
      const set = { '1X2': ['HOME', 'DRAW', 'AWAY'], OU: ['OVER', 'UNDER'], BTTS: ['YES', 'NO'], DNB: ['HOME', 'AWAY'] }[marketCode];
      const r = devig(marketCode, Object.fromEntries(set.map((s) => [s, bookOdds(best.bookmakerKey, marketCode, s, line)])));
      market = r.complete ? { pDevig: r.pFair[selectionCode], overround: r.overround } : { reason: r.reason };
    }

    const isDnb = marketCode === 'DNB';
    const pModel = isDnb ? prob.win : prob.p;
    const pModelComparable = isDnb ? dnbConditional(prob) : prob.p; // DNB market is conditional on no draw
    const ev = isDnb ? expectedValueDnb(prob, best.decimalOdds) : expectedValue(prob.p, best.decimalOdds);
    const record = {
      ...base,
      bestQuote: { bookmakerKey: best.bookmakerKey, bookmakerName: best.bookmakerName, decimalOdds: best.decimalOdds, capturedAt: best.capturedAt },
      pRaw: 1 / best.decimalOdds,
      pDevig: market.pDevig ?? null,
      overround: market.overround ?? null,
      ev,
      bookmakerCount,
      notes,
    };

    if (ev <= config.evWatchMin) {
      selections.push({ ...record, status: 'NO_VALUE', reasonCodes: ['EV_NOT_POSITIVE'] });
      continue;
    }
    const q = [];
    if (ev < config.evQualifyMin) q.push('EV_BELOW_QUALIFY');
    if (market.reason) q.push('MARKET_INCOMPLETE');
    if (market.overround !== undefined && (market.overround < config.overroundMin || market.overround > config.overroundMax)) q.push('OVERROUND_ABNORMAL');
    if (market.pDevig !== undefined && Math.abs(pModelComparable - market.pDevig) > config.divergenceMax) q.push('MODEL_MARKET_DIVERGENCE');
    if (pModel < config.pQualifyMin) q.push('PROB_TOO_LOW');
    if (best.decimalOdds < config.qualifyOddsMin || best.decimalOdds > config.qualifyOddsMax) q.push('ODDS_OUT_OF_RANGE');
    if (bookmakerCount < config.minBookmakers) q.push('THIN_MARKET');
    selections.push({ ...record, status: q.length ? 'WATCHLIST' : 'QUALIFIED', reasonCodes: q });
  }

  const summary = { INSUFFICIENT_DATA: 0, NO_VALUE: 0, WATCHLIST: 0, QUALIFIED: 0 };
  for (const s of selections) summary[s.status] += 1;
  return {
    riskVersion: RISK_VERSION,
    riskConfigHash: riskConfigHash(config),
    modelVersion: estimate.modelVersion,
    modelConfigHash: estimate.configHash,
    mode,
    evaluatedAt: now.toISOString(),
    fixtureReasons: [...new Set(fixtureReasons)],
    summary,
    selections,
  };
}

module.exports = { evaluateFixture, SELECTIONS, latestQuotes };

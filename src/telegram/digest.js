'use strict';

const { buildFacts } = require('../explain/facts');
const { reasonText } = require('../explain/labels');
const { DISCLAIMER } = require('../explain/template');
const { marketViewLines, CUP_NOTE } = require('./marketView');
const { defaultRiskConfig } = require('../domain/risk/config');
const { pickLine, PLAYABLE_NOTE, PAPER_NOTE } = require('./lineView');

const MAX_ITEMS = 25; // per section; keeps the digest readable and under the stored-text limit

/**
 * Daily scanner digest (Romanian, plain text). Every number comes from the risk engine
 * through buildFacts(); nothing is computed here except counts.
 *
 * @param {{
 *   scanDate: string,
 *   horizonHours: number,
 *   results: { match: object, estimate: object, evaluation: object }[],
 *   failed: number,
 *   usage?: { used: number, monthlyLimit: number, providerRemaining: number|null } | null,
 *   modelVersion: string,
 *   riskVersion: string,
 *   cups?: { event: object, consensus: object }[],   UCL/UEL market-only view (D-19)
 *   lineResults?: { fixture: object, match: string, kickoff: string, selections: object[] }[],   line shopping (D-24)
 * }} input
 */
function buildDigest({ scanDate, horizonHours, results, failed, usage = null, modelVersion, riskVersion, cups = [], lineResults = [] }) {
  const items = { QUALIFIED: [], WATCHLIST: [] };
  const totals = { QUALIFIED: 0, WATCHLIST: 0, NO_VALUE: 0, INSUFFICIENT_DATA: 0 };
  const fixtureReasons = new Map();
  let notAnalysable = 0;
  for (const r of results) {
    for (const [k, v] of Object.entries(r.evaluation.summary)) totals[k] += v;
    if (r.evaluation.fixtureReasons.length) {
      notAnalysable += 1;
      for (const code of r.evaluation.fixtureReasons) fixtureReasons.set(code, (fixtureReasons.get(code) || 0) + 1);
    }
    const facts = buildFacts({ match: r.match, evaluation: r.evaluation, estimate: r.estimate });
    const evs = r.evaluation.selections.filter((s) => s.status === 'QUALIFIED' || s.status === 'WATCHLIST');
    facts.highlights.forEach((h, i) => items[h.status].push({ facts, h, ev: evs[i].ev }));
  }

  const lines = [`FVIS — scanare zilnică ${scanDate}`, ''];

  // Short summary first (D-22, adapted for D-24): today's line-shopping candidates at the
  // PO's bookmakers, in kickoff order. Numbers come from evaluateLineShopping().
  lines.push('SELECȚIILE ZILEI (LINE_VALUE · Unibet)');
  const picks = lineResults
    .flatMap((r) => r.selections.filter((s) => s.scope === 'playable' && s.status === 'LINE_VALUE').map((s) => ({ r, s })))
    .sort((a, b) => Date.parse(a.r.fixture.kickoffUtc) - Date.parse(b.r.fixture.kickoffUtc) || (a.r.match < b.r.match ? -1 : 1));
  const allCount = lineResults.reduce((n, r) => n + r.selections.filter((s) => s.scope === 'all' && s.status === 'LINE_VALUE').length, 0);
  if (!picks.length) lines.push('Niciuna azi la Unibet.');
  for (const { r, s } of picks.slice(0, MAX_ITEMS)) lines.push(pickLine(r, s));
  if (picks.length > MAX_ITEMS) lines.push(`… și încă ${picks.length - MAX_ITEMS}`);
  lines.push(`Toate casele din sursă: ${allCount} candidate (înregistrate pentru test, inclusiv la case care nu sunt pe lista ta).`);
  if (picks.length) lines.push(PLAYABLE_NOTE);
  lines.push(PAPER_NOTE, 'Rezultatele testului: /clv');
  lines.push('', 'DETALII');
  lines.push(`Meciuri analizate: ${results.length} (următoarele ${horizonHours} h, ligile interne)`);
  if (failed) lines.push(`Meciuri cu eroare de procesare: ${failed}`);
  if (notAnalysable) {
    const top = [...fixtureReasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${reasonText(c)} (${n})`);
    lines.push(`Meciuri fără analiză de valoare: ${notAnalysable} — ${top.join('; ')}`);
  }
  lines.push(`Selecții model: ${totals.QUALIFIED} eligibile, ${totals.WATCHLIST} de urmărit, ${totals.NO_VALUE} fără valoare, ${totals.INSUFFICIENT_DATA} cu date insuficiente`);
  if (!defaultRiskConfig().qualifyEnabled) lines.push('Modelul Poisson rămâne doar referință de cercetare: QUALIFIED este suspendat, backtestul nu arată valoare reală (D-23).');

  const section = (status, title) => {
    const list = items[status].sort((a, b) => b.ev - a.ev || (a.facts.match < b.facts.match ? -1 : 1));
    if (!list.length) return;
    lines.push('', title);
    for (const { facts, h } of list.slice(0, MAX_ITEMS)) {
      lines.push(`• ${facts.competition} · ${facts.kickoff} — ${facts.match}`);
      lines.push(`  ${h.selection}: cotă ${h.bestOdds} (${h.bookmaker}) · model ${h.modelProbability} · piață ${h.marketProbability ?? 'n/a'} · EV ${h.expectedValue}`);
      if (h.reasons.length) lines.push(`  condiții neîndeplinite: ${h.reasons.join('; ')}`);
    }
    if (list.length > MAX_ITEMS) lines.push(`… și încă ${list.length - MAX_ITEMS}`);
  };
  section('QUALIFIED', 'ELIGIBILE PENTRU URMĂRIRE (QUALIFIED)');
  section('WATCHLIST', 'DE URMĂRIT (WATCHLIST)');
  if (!items.QUALIFIED.length && !items.WATCHLIST.length) lines.push('', 'Modelul nu identifică azi selecții cu valoare pozitivă.');

  if (cups.length) {
    lines.push('', 'CUPE EUROPENE — DOAR PIAȚA (informativ)');
    for (const c of cups.slice(0, MAX_ITEMS)) lines.push(...marketViewLines(c));
    if (cups.length > MAX_ITEMS) lines.push(`… și încă ${cups.length - MAX_ITEMS}`);
    lines.push(CUP_NOTE);
  }

  lines.push('');
  if (usage) lines.push(`Credite cote luna aceasta: ${usage.used} din ${usage.monthlyLimit} (rămase la furnizor: ${usage.providerRemaining ?? 'necunoscut'})`);
  lines.push('Piețe scanate zilnic: 1X2 și Peste/Sub (linia principală); restul doar la cerere (/analyze).');
  lines.push(`Model ${modelVersion} · reguli de risc ${riskVersion}. ${DISCLAIMER}`);
  return lines.join('\n');
}

module.exports = { buildDigest, MAX_ITEMS };

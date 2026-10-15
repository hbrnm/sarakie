'use strict';

const { STATUS } = require('./labels');

const DISCLAIMER =
  'FVIS este un instrument de cercetare. Probabilitățile sunt estimări ale unui model, cu limitări cunoscute. ' +
  '„QUALIFIED” înseamnă doar eligibil pentru urmărire și validare pe hârtie — nu sigur, nu garantat, nu profitabil.';

/** Deterministic commentary used when Gemini is disabled, fails, or is rejected. */
function templateCommentary(facts) {
  if (!facts.expectedGoals) return `Analiza nu este posibilă: ${facts.fixtureReasons.join('; ') || 'date insuficiente'}.`;
  const q = facts.highlights.filter((h) => h.status === 'QUALIFIED').length;
  const w = facts.highlights.filter((h) => h.status === 'WATCHLIST').length;
  if (!q && !w) return 'Modelul nu identifică valoare pozitivă la cotele disponibile.';
  return `Modelul identifică ${q} selecții eligibile pentru urmărire și ${w} de urmărit. Diferențele față de piață pot reflecta informații pe care modelul nu le are.`;
}

/** Full message: numbers always come from the deterministic template; only the commentary may come from Gemini. */
function renderAnalysis(facts, commentary) {
  const lines = [`${facts.competition}: ${facts.match}`, facts.kickoff, ''];
  if (facts.expectedGoals) lines.push(`Goluri așteptate (model): ${facts.expectedGoals.home} – ${facts.expectedGoals.away}`, '');
  if (facts.fixtureReasons.length) lines.push(`Date insuficiente: ${facts.fixtureReasons.join('; ')}`, '');
  for (const h of facts.highlights) {
    lines.push(`${h.selection} — ${STATUS[h.status]}`);
    lines.push(`  model ${h.modelProbability} (cotă corectă ${h.fairOdds}) · cotă ${h.bestOdds} (${h.bookmaker}) · piață ${h.marketProbability ?? 'n/a'} · EV ${h.expectedValue}`);
    if (h.reasons.length) lines.push(`  condiții neîndeplinite: ${h.reasons.join('; ')}`);
  }
  const s = facts.summary;
  lines.push(`Rezumat: ${s.QUALIFIED} eligibile, ${s.WATCHLIST} de urmărit, ${s.NO_VALUE} fără valoare, ${s.INSUFFICIENT_DATA} cu date insuficiente.`);
  lines.push('', commentary, '', `Limitări: ${facts.limitations.join(' ')}`, '', `Model ${facts.modelVersion}. ${DISCLAIMER}`);
  return lines.join('\n');
}

module.exports = { templateCommentary, renderAnalysis, DISCLAIMER };

'use strict';

const { selectionLabel, reasonText } = require('../explain/labels');

// Phase 6d (D-24): line-shopping display. Numbers come from evaluateLineShopping(); this file
// only formats them.

const pct = (p) => `${(p * 100).toFixed(1)}%`;
const signedPct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

/** "unibet_se" → "Unibet (SE)", "onexbet" → "Onexbet". */
function bookmakerLabel(key) {
  if (!key) return 'n/a';
  const [name, region] = key.split('_');
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return region ? `${cap} (${region.toUpperCase()})` : cap;
}

const PLAYABLE_NOTE = 'Prețul Unibet vine de la site-urile Unibet SE/NL/FR și aproximează unibet.ro: verifică cota înainte. Betano, Superbet, Fortuna, MrBit și GSBet nu sunt acoperite de sursa de cote.';
const PAPER_NOTE = 'Test pe hârtie (Faza 6d): probabilitatea vine din cotele Pinnacle fără marjă (metoda puterii); FVIS nu dă sfaturi de pariere.';

/** One digest line for a LINE_VALUE candidate. */
function pickLine({ match, kickoff }, s) {
  return `• ${match} · ${selectionLabel('1X2', s.selectionCode, null)} · ${bookmakerLabel(s.bookmakerKey)} ${s.price.toFixed(2)} · avantaj ${signedPct(s.edge)} · ${kickoff}`;
}

/**
 * The /analyze section for one fixture: per 1X2 selection, Pinnacle fair probability, best
 * price overall and at Unibet, edge and status.
 * @param {{ reference: object|null, selections: object[] }} evaluation
 */
function lineSectionLines(evaluation) {
  const lines = ['CĂUTAREA CELUI MAI BUN PREȚ (1X2, Faza 6d)'];
  if (!evaluation.reference) {
    lines.push('Fără cote Pinnacle complete și recente: nu există referință (INSUFFICIENT_DATA).');
    return lines;
  }
  for (const sel of ['HOME', 'DRAW', 'AWAY']) {
    const all = evaluation.selections.find((s) => s.selectionCode === sel && s.scope === 'all');
    const pl = evaluation.selections.find((s) => s.selectionCode === sel && s.scope === 'playable');
    const part = (s) => (s.price === null ? 'fără preț' : `${bookmakerLabel(s.bookmakerKey)} ${s.price.toFixed(2)}, avantaj ${signedPct(s.edge)}, ${s.status}`);
    lines.push(`• ${selectionLabel('1X2', sel, null)}: Pinnacle ${all.pinOdds.toFixed(2)} → ${pct(all.pPin)}`);
    lines.push(`  cel mai bun preț: ${part(all)}`);
    lines.push(`  Unibet: ${part(pl)}`);
    const reasons = [...new Set(pl.reasonCodes)].filter((c) => pl.status === 'WATCHLIST' || c === 'NO_PLAYABLE_PRICE');
    if (reasons.length) lines.push(`  Unibet, condiții neîndeplinite: ${reasons.map(reasonText).join('; ')}`);
  }
  lines.push(PAPER_NOTE);
  return lines;
}

const VERDICT = Object.freeze({
  IN_PROGRESS: 'în curs',
  EDGE_CONFIRMED: 'avantaj confirmat live (decizia de folosire îți aparține)',
  EXTEND: 'neconcludent: testul se prelungește',
  STOP: 'fără avantaj: testul se oprește',
});

const LEAD_LABELS = Object.freeze([['lt12', '< 12h'], ['h12to48', '12–48h'], ['other', 'altele (> 48h)']]);

/**
 * /clv reply from lineReport(): paper-test progress per scope (docs/23 §5, §9).
 * @param {ReturnType<typeof import('../domain/lineShopping/report').lineReport>} report
 */
function clvMessage(report) {
  const older = report.otherVersionRows
    ? `Rândurile LINE_VALUE din versiuni anterioare ale regulii (${report.otherVersionRows}) rămân în baza de date, dar nu intră în calcul.`
    : null;
  if (!report.startedAt) return [`Testul pe hârtie (Faza 6d, regula ${report.ruleVersion}) nu are încă nicio candidată LINE_VALUE.`, older].filter(Boolean).join('\n');
  const ci = (m) => (m.mean === null ? 'n/a' : m.low === null ? signedPct(m.mean) : `${signedPct(m.mean)} (IÎ 95%: ${signedPct(m.low)} … ${signedPct(m.high)})`);
  const opt = (x) => (x === null ? 'n/a' : signedPct(x));
  const lines = [`Test pe hârtie line shopping (Faza 6d, regula ${report.ruleVersion}), început ${report.startedAt.slice(0, 10)}, ${report.weeks.toFixed(1)} săptămâni`, ''];
  for (const [scope, title] of [['playable', 'UNIBET (casele tale)'], ['all', 'TOATE CASELE DIN SURSĂ']]) {
    const s = report.scopes[scope];
    lines.push(title);
    lines.push(`Candidate: ${s.candidates} · decontate: ${s.settled} (${s.wins} câștigate) · în așteptare: ${s.pending}`);
    lines.push(`Cu cotă de închidere Pinnacle: ${s.withClosing} candidate din ${s.fixturesWithClosing} meciuri distincte (prag: ${report.minSettled} candidate din cel puțin ${report.minFixtures} meciuri)`);
    lines.push(`CLV mediu: ${ci(s.clv)}`);
    lines.push(`EV la închidere: ${ci(s.closeEv)}`);
    lines.push('După timpul până la start (captură → start):');
    for (const [b, label] of LEAD_LABELS) {
      const x = s.byLead[b];
      if (b === 'other' && !x.candidates) continue;
      lines.push(`  ${label}: ${x.candidates} candidate · CLV mediu ${opt(x.clv)} · EV la închidere ${opt(x.closeEv)}`);
    }
    lines.push(`ROI pe hârtie: ${s.roi === null ? 'n/a' : signedPct(s.roi)} (informativ, nu e criteriu)`);
    lines.push(`Verdict: ${VERDICT[s.verdict]}`, '');
  }
  lines.push(`Criteriu (stabilit înainte de test): după cel puțin ${report.minWeeks} săptămâni și ${report.minSettled} candidate cu închidere din cel puțin ${report.minFixtures} meciuri distincte, EV la închidere > 0 cu IÎ 95% peste 0 și CLV > 0. IÎ este grupat pe meci (selecțiile aceluiași meci nu sunt independente).`);
  if (older) lines.push(older);
  lines.push(PAPER_NOTE);
  return lines.join('\n');
}

module.exports = { bookmakerLabel, pickLine, lineSectionLines, clvMessage, PLAYABLE_NOTE, PAPER_NOTE };

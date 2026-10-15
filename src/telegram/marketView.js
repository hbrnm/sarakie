'use strict';

const { getCompetition } = require('../domain/competitions');
const { formatKickoff, formatTime } = require('../time/format');

// D-19: UCL/UEL are shown with market-implied probabilities only. The model does not apply
// across leagues (D-13), so there is no model probability, EV or status here.

const pct = (p) => `${(p * 100).toFixed(1)}%`;

/** One market-view line pair: match header and consensus probabilities. */
function marketViewLines({ event, consensus }) {
  const comp = getCompetition(event.competitionCode).name;
  const head = `• ${comp} · ${formatKickoff(new Date(event.kickoffUtc))} — ${event.homeTeamName} – ${event.awayTeamName}`;
  const parts = [];
  const x = consensus['1X2'];
  if (x) parts.push(`1 ${pct(x.HOME)} · X ${pct(x.DRAW)} · 2 ${pct(x.AWAY)}`);
  if (consensus.OU) parts.push(`Peste ${consensus.OU.line} ${pct(consensus.OU.OVER)}`);
  const books = x ? x.books : consensus.OU ? consensus.OU.books : 0;
  const when = consensus.latestCapturedAt ? `, cote de la ${formatTime(new Date(consensus.latestCapturedAt))}` : '';
  return [head, parts.length ? `  piață: ${parts.join(' · ')} (${books} case${when})` : '  piață: fără cote complete'];
}

const CUP_NOTE = 'Doar informativ: probabilități implicite ale pieței (media caselor, fără marjă). Modelul FVIS nu se aplică meciurilor din cupele europene (D-13), deci nu există EV sau statusuri.';

/** Reply to /analyze for a UCL/UEL match. */
function marketViewMessage({ event, consensus }) {
  return [...marketViewLines({ event, consensus }), '', CUP_NOTE].join('\n');
}

module.exports = { marketViewLines, marketViewMessage, CUP_NOTE };

'use strict';

const { selectionLabel, reasonText } = require('./labels');

const pct = (p) => `${(p * 100).toFixed(1)}%`;
const odds = (o) => (o === null || o === undefined ? 'n/a' : o.toFixed(2));
const signedPct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

const LIMITATIONS = Object.freeze([
  'Modelul Poisson independent tinde să subestimeze egalurile și scorurile mici.',
  'Modelul nu știe de accidentări, suspendări, rotații sau motivație.',
  'Parametrii modelului sunt provizorii și nevalidați (validarea vine în Faza 6).',
]);

/**
 * The only material an explanation may use: frozen, pre-formatted values computed by the
 * model and the risk engine. The explanation layer never computes or changes numbers.
 */
function buildFacts({ match, evaluation, estimate }) {
  const fmt = (s) => {
    const p = s.model ? (s.marketCode === 'DNB' ? s.model.win : s.model.p) : null;
    return {
      selection: selectionLabel(s.marketCode, s.selectionCode, s.line),
      status: s.status,
      modelProbability: p === null ? null : pct(p),
      fairOdds: s.model ? odds(s.model.fairOdds) : null,
      bestOdds: s.bestQuote ? odds(s.bestQuote.decimalOdds) : null,
      bookmaker: s.bestQuote ? s.bestQuote.bookmakerName : null,
      marketProbability: s.pDevig === null || s.pDevig === undefined ? null : pct(s.pDevig),
      expectedValue: s.ev === undefined ? null : signedPct(s.ev),
      reasons: s.reasonCodes.map(reasonText),
    };
  };
  const highlights = evaluation.selections.filter((s) => s.status === 'QUALIFIED' || s.status === 'WATCHLIST').map(fmt);
  return Object.freeze({
    match: `${match.home} – ${match.away}`,
    competition: match.competition,
    kickoff: match.kickoff,
    expectedGoals: estimate.status === 'OK' ? { home: estimate.lambdas.home.toFixed(2), away: estimate.lambdas.away.toFixed(2) } : null,
    fixtureReasons: evaluation.fixtureReasons.map(reasonText),
    summary: { ...evaluation.summary },
    highlights,
    limitations: [...LIMITATIONS],
    modelVersion: evaluation.modelVersion,
  });
}

module.exports = { buildFacts, LIMITATIONS };

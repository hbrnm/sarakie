'use strict';

/** Canonical market and selection codes (docs/05-data-dictionary.md). */
const MARKETS = Object.freeze({
  '1X2': Object.freeze(['HOME', 'DRAW', 'AWAY']),
  DC: Object.freeze(['1X', '12', 'X2']),
  DNB: Object.freeze(['HOME', 'AWAY']),
  OU: Object.freeze(['OVER', 'UNDER']),
  BTTS: Object.freeze(['YES', 'NO']),
});

/** Over/Under lines in scope. Quarter lines (e.g. 2.75) settle differently and are excluded. */
const OU_LINES = Object.freeze([1.5, 2.5, 3.5]);

const MIN_DECIMAL_ODDS = 1.01;
const MAX_DECIMAL_ODDS = 1000;

/** @param {unknown} odds */
function isValidDecimalOdds(odds) {
  return typeof odds === 'number' && Number.isFinite(odds) && odds >= MIN_DECIMAL_ODDS && odds <= MAX_DECIMAL_ODDS;
}

function isValidSelection(marketCode, selectionCode, line) {
  const selections = MARKETS[marketCode];
  if (!selections || !selections.includes(selectionCode)) return false;
  if (marketCode === 'OU') return OU_LINES.includes(line);
  return line === null;
}

module.exports = { MARKETS, OU_LINES, isValidDecimalOdds, isValidSelection, MIN_DECIMAL_ODDS, MAX_DECIMAL_ODDS };

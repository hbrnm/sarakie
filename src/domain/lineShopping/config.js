'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('../model/config');

/**
 * Line-shopping rule (D-24, docs/23 §2). All thresholds PROVISIONAL: taken from the 6b
 * backtest and the 6c live measurement, not validated live. Phase 6d is the live paper test.
 */
const LINE_RULE_VERSION = '1.0.0';

const LINE_PARAMETERS = Object.freeze({
  sharpBookmaker: { value: 'pinnacle', class: 'PROVISIONAL', note: 'probability source: de-vigged Pinnacle 1X2' },
  minEdge: { value: 0.03, class: 'PROVISIONAL', note: '6b: edge positive from 2%; 3% leaves room for slippage' },
  minPriceOverMedian: { value: 1.03, class: 'PROVISIONAL', note: '6c: price must beat the market median, not only Pinnacle' },
  minOdds: { value: 1.3, class: 'PROVISIONAL', note: 'odds range as in 6b' },
  maxOdds: { value: 6, class: 'PROVISIONAL', note: 'odds range as in 6b' },
  minPrices: { value: 5, class: 'PROVISIONAL', note: 'thin markets are unreliable' },
  minLeadTimeMinutes: { value: 30, class: 'PROVISIONAL', note: 'kickoff at least this long after the capture' },
  maxOddsAgeMinutes: { value: 360, class: 'PROVISIONAL', note: 'odds captured in the same run (option A)' },
  excludedBookmakers: { value: ['betfair_ex_eu', 'matchbook', 'market_average', 'market_maximum'], class: 'PROVISIONAL', note: 'exchanges (commission not modelled) and aggregates' },
  // PO bookmakers (2026-10-15): betano, gsbet, superbet, mrbit, unibet, fortuna. Only Unibet
  // is covered by The Odds API, and only as its SE/NL/FR sites: a proxy for unibet.ro (UNVERIFIED).
  playableBookmakerPrefixes: { value: ['unibet'], class: 'PROVISIONAL', note: 'bookmakers available to the PO that the odds source covers' },
});

function defaultLineConfig() {
  return Object.fromEntries(Object.entries(LINE_PARAMETERS).map(([k, p]) => [k, p.value]));
}

function lineConfigHash(config) {
  return crypto.createHash('sha256').update(canonicalJson({ rule: LINE_RULE_VERSION, config })).digest('hex');
}

module.exports = { LINE_RULE_VERSION, LINE_PARAMETERS, defaultLineConfig, lineConfigHash };

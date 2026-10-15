'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('../model/config');

/**
 * Risk and eligibility thresholds (docs/06-risk-policy.md). All PROVISIONAL (D-06):
 * starting values, not validated; tuned in Phase 6.
 */
const RISK_VERSION = '1.0.0';

const RISK_PARAMETERS = Object.freeze({
  maxOddsAgeScannerMinutes: { value: 360, class: 'PROVISIONAL', note: 'scanner: odds captured in the same run (option A)' },
  maxOddsAgeOnDemandMinutes: { value: 120, class: 'PROVISIONAL', note: 'on-demand: fresh odds fetched for the fixture (option A)' },
  minLeadTimeMinutes: { value: 30, class: 'PROVISIONAL', note: 'no evaluation this close to kickoff' },
  minOdds: { value: 1.01, class: 'PROVISIONAL', note: 'odds validity (hard gate)' },
  maxOdds: { value: 100, class: 'PROVISIONAL', note: 'odds validity (hard gate)' },
  evWatchMin: { value: 0, class: 'PROVISIONAL', note: 'EV at or below → NO_VALUE' },
  evQualifyMin: { value: 0.05, class: 'PROVISIONAL', note: 'EV needed for QUALIFIED' },
  overroundMin: { value: 0, class: 'PROVISIONAL', note: 'negative overround suggests error or stale data' },
  overroundMax: { value: 0.15, class: 'PROVISIONAL', note: 'abnormal margin' },
  outlierTol: { value: 0.05, class: 'PROVISIONAL', note: 'absolute distance from cross-book median implied probability' },
  divergenceMax: { value: 0.12, class: 'PROVISIONAL', note: '|p_model − p_devig|' },
  pQualifyMin: { value: 0.15, class: 'PROVISIONAL', note: 'longshots are where Poisson is least reliable' },
  qualifyOddsMin: { value: 1.3, class: 'PROVISIONAL', note: 'odds range for QUALIFIED' },
  qualifyOddsMax: { value: 6, class: 'PROVISIONAL', note: 'odds range for QUALIFIED' },
  minBookmakers: { value: 3, class: 'PROVISIONAL', note: 'thin market below this' },
});

function defaultRiskConfig() {
  return Object.fromEntries(Object.entries(RISK_PARAMETERS).map(([k, p]) => [k, p.value]));
}

function riskConfigHash(config) {
  return crypto.createHash('sha256').update(canonicalJson({ risk: RISK_VERSION, config })).digest('hex');
}

module.exports = { RISK_VERSION, RISK_PARAMETERS, defaultRiskConfig, riskConfigHash };

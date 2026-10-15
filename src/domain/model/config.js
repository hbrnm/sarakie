'use strict';

const crypto = require('node:crypto');

/**
 * Model configuration for poisson-independent v1.0.0 (docs/04-quantitative-model-spec.md §14).
 * Every parameter carries its classification (CLAUDE.md §5). None is validated yet:
 * PROVISIONAL values are tuned in Phase 6.
 */
const MODEL_FAMILY = 'poisson-independent';
const MODEL_VERSION = '1.0.0';

const PARAMETERS = Object.freeze({
  nLeague: { value: 380, class: 'PROVISIONAL', note: 'league window, matches' },
  nLeagueMin: { value: 150, class: 'PROVISIONAL', note: 'minimum league window' },
  nTeam: { value: 38, class: 'PROVISIONAL', note: 'team window, league matches' },
  nTeamMin: { value: 5, class: 'PROVISIONAL', note: 'minimum team matches' },
  nCurMin: { value: 3, class: 'PROVISIONAL', note: 'minimum current-season matches unless n_i >= nTeam' },
  shrinkageK: { value: 8, class: 'AWAITING_VALIDATION', note: 'pseudo-count toward league average; Phase 6 grid' },
  lambdaMin: { value: 0.2, class: 'PROVISIONAL', note: 'model applicability bound' },
  lambdaMax: { value: 4.5, class: 'PROVISIONAL', note: 'model applicability bound' },
  tailTolerance: { value: 1e-12, class: 'PROVISIONAL', note: 'numerical: per-side Poisson tail beyond G' },
  maxGoals: { value: 30, class: 'PROVISIONAL', note: 'numerical cap on G; 26 needed at lambda 4.5' },
  pFloor: { value: 0.02, class: 'PROVISIONAL', note: 'below this, fair odds are not reported' },
  ouLines: { value: [1.5, 2.5, 3.5], class: 'PROVISIONAL', note: 'markets in scope' },
});

function defaultConfig() {
  return Object.fromEntries(Object.entries(PARAMETERS).map(([k, p]) => [k, Array.isArray(p.value) ? [...p.value] : p.value]));
}

/** JSON with recursively sorted keys: identical configs always serialize identically. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of family + version + canonical config (spec §13). */
function configHash(config) {
  return crypto.createHash('sha256').update(canonicalJson({ family: MODEL_FAMILY, version: MODEL_VERSION, config })).digest('hex');
}

module.exports = { MODEL_FAMILY, MODEL_VERSION, PARAMETERS, defaultConfig, canonicalJson, configHash };

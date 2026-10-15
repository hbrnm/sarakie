'use strict';

/**
 * Canonical competitions. Provider IDs are never stored here: adapters discover
 * them at runtime by name/country (CLAUDE.md §3).
 * `modelApplicable: false` → model output is INSUFFICIENT_DATA
 * (MODEL_NOT_APPLICABLE_CROSS_LEAGUE) until a validated cross-league extension exists (D-13).
 */
const COMPETITIONS = Object.freeze([
  { code: 'EPL', name: 'Premier League', country: 'England', type: 'domestic', modelApplicable: true },
  { code: 'LALIGA', name: 'La Liga', country: 'Spain', type: 'domestic', modelApplicable: true },
  { code: 'SERIEA', name: 'Serie A', country: 'Italy', type: 'domestic', modelApplicable: true },
  { code: 'BUNDESLIGA', name: 'Bundesliga', country: 'Germany', type: 'domestic', modelApplicable: true },
  { code: 'LIGUE1', name: 'Ligue 1', country: 'France', type: 'domestic', modelApplicable: true },
  { code: 'UCL', name: 'UEFA Champions League', country: 'Europe', type: 'uefa', modelApplicable: false },
  { code: 'UEL', name: 'UEFA Europa League', country: 'Europe', type: 'uefa', modelApplicable: false },
].map((c) => Object.freeze(c)));

const BY_CODE = new Map(COMPETITIONS.map((c) => [c.code, c]));

function getCompetition(code) {
  const c = BY_CODE.get(code);
  if (!c) throw new Error(`unknown competition code: ${code}`);
  return c;
}

module.exports = { COMPETITIONS, getCompetition };

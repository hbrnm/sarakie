'use strict';

const ALIAS_GROUPS = require('./aliases');

/**
 * Cross-source team matching. Each source names teams differently
 * ("Manchester United FC" / "Manchester United" / "Man United"). The canonical
 * team list comes from the fixtures provider; names from other sources are matched to it.
 *
 * Order: curated alias groups → exact normalized name → unique token-subset match.
 * Anything else is UNMATCHED or AMBIGUOUS: never guessed (→ INSUFFICIENT_DATA / TEAM_UNMAPPED).
 */

const STOP_TOKENS = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'rc', 'rcd', 'cd', 'ud', 'sd', 'club', 'de', 'del', 'calcio', 'the', 'and',
]);

/** Lower-case, accent-free, punctuation-free name without generic club tokens and numbers. */
function normalizeTeamName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP_TOKENS.has(t) && !/^\d+$/.test(t))
    .join(' ');
}

const GROUP_OF = (() => {
  const map = new Map();
  ALIAS_GROUPS.forEach((group, i) => {
    for (const name of group) {
      const key = normalizeTeamName(name);
      if (map.has(key) && map.get(key) !== i) throw new Error(`alias "${name}" appears in two groups`);
      map.set(key, i);
    }
  });
  return map;
})();

const tokens = (key) => new Set(key.split(' ').filter(Boolean));
const isSubset = (a, b) => a.size > 0 && [...a].every((t) => b.has(t));

/**
 * @param {{ id: string, names: string[] }[]} canonicalTeams
 */
function createTeamMatcher(canonicalTeams) {
  const teams = canonicalTeams.map((t) => ({ id: t.id, keys: [...new Set(t.names.filter(Boolean).map(normalizeTeamName))].filter(Boolean) }));

  /** @returns {{ teamId: string, method: string } | { teamId: null, reason: 'UNMATCHED' | 'AMBIGUOUS', candidates: string[] }} */
  function match(name) {
    const key = normalizeTeamName(name);
    const unique = (ids, method) => {
      const set = [...new Set(ids)];
      if (set.length === 1) return { teamId: set[0], method };
      if (set.length > 1) return { teamId: null, reason: 'AMBIGUOUS', candidates: set };
      return null;
    };

    if (GROUP_OF.has(key)) {
      const g = GROUP_OF.get(key);
      const r = unique(teams.filter((t) => t.keys.some((k) => GROUP_OF.get(k) === g)).map((t) => t.id), 'alias');
      if (r) return r;
    }
    const exact = unique(teams.filter((t) => t.keys.includes(key)).map((t) => t.id), 'exact');
    if (exact) return exact;

    const kt = tokens(key);
    const subset = unique(
      teams.filter((t) => t.keys.some((k) => isSubset(kt, tokens(k)) || isSubset(tokens(k), kt))).map((t) => t.id),
      'token_subset',
    );
    if (subset) return subset;
    return { teamId: null, reason: 'UNMATCHED', candidates: [] };
  }

  return { match };
}

/**
 * Links odds events to fixtures: same competition, both teams resolved to the same
 * canonical teams, kickoff within `toleranceMinutes`.
 */
function linkEventsToFixtures({ events, fixtures, matcher, toleranceMinutes = 180 }) {
  const links = [];
  const unlinked = [];
  for (const ev of events) {
    const h = matcher.match(ev.homeTeamName);
    const a = matcher.match(ev.awayTeamName);
    if (!h.teamId || !a.teamId) {
      unlinked.push({ event: ev, reason: 'TEAM_UNMAPPED', home: h, away: a });
      continue;
    }
    const t = Date.parse(ev.kickoffUtc);
    const fx = fixtures.find(
      (f) =>
        f.competitionCode === ev.competitionCode &&
        f.home.providerTeamId === h.teamId &&
        f.away.providerTeamId === a.teamId &&
        Math.abs(Date.parse(f.kickoffUtc) - t) <= toleranceMinutes * 60_000,
    );
    if (fx) links.push({ providerEventId: ev.providerEventId, providerFixtureId: fx.providerFixtureId });
    else unlinked.push({ event: ev, reason: 'FIXTURE_NOT_FOUND' });
  }
  return { links, unlinked };
}

module.exports = { normalizeTeamName, createTeamMatcher, linkEventsToFixtures };

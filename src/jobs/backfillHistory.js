'use strict';

const { createTeamMatcher } = require('../domain/teams/matching');
const { COMPETITIONS } = require('../domain/competitions');

const PRIMARY = 'football_data_org';
const CSV = 'football_data_co_uk';
const LINK_TOLERANCE_MS = 36 * 3600 * 1000; // CSV dates are UK-local; kickoffs can shift by a day

/**
 * Loads finished matches (football-data.org) and closing odds (football-data.co.uk)
 * for the given seasons of the domestic leagues. Idempotent: fixtures are upserted and
 * closing odds of an already-imported match are skipped.
 *
 * @param {{
 *   fd: ReturnType<typeof import('../providers/footballDataOrg').createFootballDataOrgAdapter>,
 *   uk: ReturnType<typeof import('../providers/footballDataCoUk').createFootballDataCoUkAdapter>,
 *   repo: ReturnType<typeof import('../persistence/repositories').createRepositories>,
 *   seasons?: number[],
 *   competitionCodes?: string[],
 * }} deps
 */
async function backfillHistory({ fd, uk, repo, seasons, competitionCodes }) {
  const discovered = await fd.listCompetitions();
  await repo.upsertProviderCompetitions(discovered);
  const codes = competitionCodes || COMPETITIONS.filter((c) => c.type === 'domestic').map((c) => c.code);
  const report = [];

  for (const code of codes) {
    const comp = discovered.find((c) => c.competitionCode === code);
    if (!comp) {
      report.push({ code, error: 'NO_PROVIDER_COVERAGE' });
      continue;
    }
    const seasonList = seasons || [comp.currentSeason - 1, comp.currentSeason];
    for (const season of seasonList) {
      const entry = { code, season };
      report.push(entry);
      try {
        const teams = await fd.listTeams({ competitionCode: code, season });
        const teamIds = await repo.ensurePrimaryTeams(PRIMARY, teams);
        entry.teams = teams.length;

        const { fixtures, report: norm } = await fd.listResults({ competitionCode: code, season });
        const { saved, skipped } = await repo.upsertFixtures(fixtures, teamIds);
        entry.results = { received: norm.received, saved: saved.size, skipped, dropped: norm.dropped };

        if (!uk.supports(code)) continue;
        const csv = await uk.getSeason({ competitionCode: code, season });
        const matcher = createTeamMatcher(teams.map((t) => ({ id: t.providerTeamId, names: [t.name, t.shortName] })));
        const secondary = new Map();
        const unmatched = new Set();
        const fixtureIdByEvent = new Map();
        for (const row of csv.fixtures) {
          const h = matcher.match(row.home.name);
          const a = matcher.match(row.away.name);
          for (const [name, m] of [[row.home.name, h], [row.away.name, a]]) {
            if (m.teamId) secondary.set(name, { providerName: name, teamId: teamIds.get(m.teamId), method: m.method });
            else unmatched.add(name);
          }
          if (!h.teamId || !a.teamId) continue;
          const t = Date.parse(row.kickoffUtc);
          const fx = fixtures.find(
            (f) => f.home.providerTeamId === h.teamId && f.away.providerTeamId === a.teamId && Math.abs(Date.parse(f.kickoffUtc) - t) <= LINK_TOLERANCE_MS,
          );
          if (fx && saved.has(fx.providerFixtureId)) fixtureIdByEvent.set(row.providerFixtureId, saved.get(fx.providerFixtureId));
        }
        await repo.upsertSecondaryTeamMap(CSV, [...secondary.values()].filter((e) => e.teamId));
        const linkedQuotes = csv.closingQuotes.filter((q) => fixtureIdByEvent.has(q.providerEventId));
        const ins = await repo.insertOddsSnapshots(linkedQuotes, { fixtureIdByEvent, skipExistingEvents: true });
        entry.csv = {
          rows: csv.fixtures.length,
          linked: fixtureIdByEvent.size,
          unmatchedNames: [...unmatched],
          closingInserted: ins.inserted,
          closingEventsAlreadyPresent: ins.skippedEvents,
        };
      } catch (err) {
        entry.error = `${err.code || 'ERROR'}: ${err.message}`;
      }
    }
  }
  return report;
}

module.exports = { backfillHistory };

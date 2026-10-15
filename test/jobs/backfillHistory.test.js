'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backfillHistory } = require('../../src/jobs/backfillHistory');
const { createRepositories } = require('../../src/persistence/repositories');
const { createFakeDb } = require('../persistence/fakeDb');

const TEAMS = {
  2025: [{ providerTeamId: '57', name: 'Arsenal FC', shortName: 'Arsenal' }, { providerTeamId: '66', name: 'Manchester United FC', shortName: 'Man United' }, { providerTeamId: '63', name: 'Fulham FC', shortName: 'Fulham' }],
  2026: [{ providerTeamId: '57', name: 'Arsenal FC', shortName: 'Arsenal' }, { providerTeamId: '66', name: 'Manchester United FC', shortName: 'Man United' }, { providerTeamId: '322', name: 'Hull City AFC', shortName: 'Hull City' }],
};
const result = (id, season, home, away, kickoff, hg, ag) => ({
  sourceProvider: 'football_data_org', providerFixtureId: id, competitionCode: 'EPL', season, kickoffUtc: kickoff, status: 'FINISHED',
  home: { providerTeamId: home }, away: { providerTeamId: away }, homeGoals: hg, awayGoals: ag, matchday: 1, stage: null,
});
const RESULTS = {
  2025: [result('900', 2025, '57', '63', '2025-08-16T14:00:00.000Z', 2, 0)],
  2026: [result('1001', 2026, '57', '66', '2026-08-22T11:30:00.000Z', 1, 1), result('1002', 2026, '322', '57', '2026-08-29T14:00:00.000Z', 0, 3)],
};
const csvRow = (season, date, home, away, hg, ag) => ({
  fixture: { providerFixtureId: `EPL:${season}:${date.slice(0, 10)}:${home}:${away}`, kickoffUtc: date, home: { name: home }, away: { name: away }, homeGoals: hg, awayGoals: ag },
});
const CSV = {
  2025: [csvRow(2025, '2025-08-16T14:00:00.000Z', 'Arsenal', 'Fulham', 2, 0)],
  2026: [csvRow(2026, '2026-08-22T11:30:00.000Z', 'Arsenal', 'Man United', 1, 1), csvRow(2026, '2026-08-29T14:00:00.000Z', 'Hull', 'Arsenal', 0, 3), csvRow(2026, '2026-09-05T14:00:00.000Z', 'Mystery Town', 'Arsenal', 0, 0)],
};

function fakes() {
  const fd = {
    listCompetitions: async () => [{ competitionCode: 'EPL', sourceProvider: 'football_data_org', providerCompetitionId: '2021', providerName: 'Premier League', currentSeason: 2026 }],
    listTeams: async ({ season }) => TEAMS[season],
    listResults: async ({ season }) => ({ fixtures: RESULTS[season], report: { received: RESULTS[season].length, accepted: RESULTS[season].length, dropped: {} } }),
  };
  const uk = {
    supports: (c) => c === 'EPL',
    getSeason: async ({ season }) => {
      const fixtures = CSV[season].map((r) => r.fixture);
      const closingQuotes = fixtures.flatMap((f) =>
        ['HOME', 'DRAW', 'AWAY'].map((sel, i) => ({
          sourceProvider: 'football_data_co_uk', providerEventId: f.providerFixtureId, bookmakerKey: 'market_average', bookmakerName: 'Market average',
          marketCode: '1X2', selectionCode: sel, line: null, decimalOdds: [2.0, 3.4, 3.8][i], kind: 'closing', sourceTimestamp: null, capturedAt: '2026-10-15T08:00:00.000Z',
        })),
      );
      return { fixtures, closingQuotes, report: {} };
    },
  };
  return { fd, uk };
}

test('backfill stores results, maps CSV teams, links closing odds, reports unmatched names', async () => {
  const db = createFakeDb();
  const repo = createRepositories(db);
  const { fd, uk } = fakes();
  const report = await backfillHistory({ fd, uk, repo, competitionCodes: ['EPL'] });

  assert.deepEqual(report.map((r) => [r.season, r.results.saved, r.csv.linked, r.csv.closingInserted]), [[2025, 1, 1, 3], [2026, 2, 2, 6]]);
  assert.deepEqual(report[1].csv.unmatchedNames, ['Mystery Town']);
  assert.equal(db.table('teams').length, 4); // Arsenal, Man United, Fulham, Hull — no duplicates across seasons
  assert.equal(db.table('fixtures').length, 3);
  assert.ok(db.table('odds_snapshots').every((r) => r.fixture_id && r.kind === 'closing'));
  const methods = Object.fromEntries(db.table('provider_team_map').filter((r) => r.source_provider === 'football_data_co_uk').map((r) => [r.provider_name, r.match_method]));
  assert.deepEqual(methods, { Arsenal: 'exact', Fulham: 'exact', 'Man United': 'alias', Hull: 'token_subset' });
});

test('backfill is idempotent', async () => {
  const db = createFakeDb();
  const repo = createRepositories(db);
  const { fd, uk } = fakes();
  await backfillHistory({ fd, uk, repo, competitionCodes: ['EPL'] });
  const again = await backfillHistory({ fd, uk, repo, competitionCodes: ['EPL'] });
  assert.deepEqual(again.map((r) => r.csv.closingInserted), [0, 0]);
  assert.equal(db.table('fixtures').length, 3);
  assert.equal(db.table('teams').length, 4);
  assert.equal(db.table('odds_snapshots').length, 9);
});

test('a missing competition is reported, not thrown', async () => {
  const { fd, uk } = fakes();
  const report = await backfillHistory({ fd, uk, repo: createRepositories(createFakeDb()), competitionCodes: ['LALIGA'] });
  assert.deepEqual(report, [{ code: 'LALIGA', error: 'NO_PROVIDER_COVERAGE' }]);
});

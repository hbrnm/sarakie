'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dailySync } = require('../../src/jobs/dailySync');
const { createRepositories } = require('../../src/persistence/repositories');
const { createFakeDb } = require('../persistence/fakeDb');

const NOW = new Date('2026-10-16T07:17:00Z');
const H = 3600000;
const at = (h) => new Date(NOW.getTime() + h * H).toISOString();
const team = (id, name, shortName) => ({ providerTeamId: id, name, shortName, tla: null });
const fx = (id, comp, home, away, kickoff, status = 'SCHEDULED', goals = [null, null]) => ({
  sourceProvider: 'football_data_org', providerFixtureId: id, competitionCode: comp, season: 2026, kickoffUtc: kickoff, status,
  home, away, homeGoals: goals[0], awayGoals: goals[1], matchday: 9, stage: null,
});
const ARS = team('57', 'Arsenal FC', 'Arsenal');
const MUN = team('66', 'Manchester United FC', 'Man United');
const INT = team('108', 'FC Internazionale Milano', 'Inter');
const MIL = team('98', 'AC Milan', 'Milan');

function setup({ budgetDenied = false } = {}) {
  const fdCalls = [];
  const oddsCalls = [];
  const fixturesByComp = {
    EPL: [fx('1001', 'EPL', ARS, MUN, at(30)), fx('990', 'EPL', MUN, ARS, at(-48), 'FINISHED', [1, 2])],
    SERIEA: [fx('2001', 'SERIEA', INT, MIL, at(100))], // outside the 48 h odds horizon
  };
  const fd = {
    listCompetitions: async () => ['EPL', 'SERIEA', 'UCL'].map((c) => ({ competitionCode: c, sourceProvider: 'football_data_org', providerCompetitionId: c, providerName: c, currentSeason: 2026 })),
    listFixtures: async ({ competitionCode }) => {
      fdCalls.push(competitionCode);
      const fixtures = fixturesByComp[competitionCode] || [];
      return { fixtures, report: { received: fixtures.length, accepted: fixtures.length, dropped: {} } };
    },
  };
  const quote = (eventId, sel, odds) => ({
    sourceProvider: 'the_odds_api', providerEventId: eventId, competitionCode: 'EPL', kickoffUtc: at(30), homeTeamName: 'Arsenal', awayTeamName: 'Manchester United',
    bookmakerKey: 'pinnacle', bookmakerName: 'Pinnacle', marketCode: '1X2', selectionCode: sel, line: null, decimalOdds: odds, sourceTimestamp: null, capturedAt: NOW.toISOString(), kind: 'pre_match',
  });
  const odds = {
    listCompetitions: async () => ['EPL', 'SERIEA', 'UCL', 'UEL'].map((c) => ({ competitionCode: c, sourceProvider: 'the_odds_api', providerCompetitionId: `soccer_${c}`, providerName: c })),
    listEvents: async ({ competitionCode }) => {
      oddsCalls.push(`events:${competitionCode}`);
      return { events: [{ providerEventId: 'uel1', competitionCode, kickoffUtc: at(200), homeTeamName: 'Roma', awayTeamName: 'Ajax' }], credits: { last: 0 } };
    },
    getFeaturedOdds: async ({ competitionCode, purpose }) => {
      oddsCalls.push(`featured:${competitionCode}:${purpose}`);
      if (budgetDenied) throw Object.assign(new Error('refused'), { code: 'CREDIT_BUDGET', reason: 'MONTHLY_BUDGET_RESERVE' });
      return {
        events: [{ providerEventId: 'ev1', competitionCode, kickoffUtc: at(30), homeTeamName: 'Arsenal', awayTeamName: 'Manchester United' }],
        quotes: [quote('ev1', 'HOME', 2.1), quote('ev1', 'DRAW', 3.5), quote('ev1', 'AWAY', 3.3)],
        report: {},
        credits: { last: 2, remaining: 440 },
      };
    },
  };
  const db = createFakeDb();
  return { fd, odds, db, repo: createRepositories(db, { now: () => NOW }), fdCalls, oddsCalls };
}

test('syncs fixtures, captures odds only for competitions with a match in 48 h, links events', async () => {
  const s = setup();
  const report = await dailySync({ fd: s.fd, odds: s.odds, repo: s.repo, now: () => NOW });
  const by = Object.fromEntries(report.map((r) => [r.code, r]));

  assert.deepEqual(s.oddsCalls, ['featured:EPL:scanner', 'events:UEL']); // no paid call for SERIEA/UCL
  assert.equal(by.EPL.odds.linked, 1);
  assert.equal(by.EPL.odds.quotes, 3);
  assert.equal(by.SERIEA.odds, 'NO_MATCH_IN_HORIZON');
  assert.equal(by.UEL.fixtures, 'NO_PROVIDER_COVERAGE');
  assert.equal(by.UEL.odds, 'NO_MATCH_IN_HORIZON');
  assert.equal(by.LALIGA.fixtures, 'NO_PROVIDER_COVERAGE');

  const fixtures = s.db.table('fixtures');
  assert.equal(fixtures.length, 3);
  assert.equal(fixtures.find((f) => f.provider_fixture_id === '990').home_goals, 1);
  const ev1Fixture = fixtures.find((f) => f.provider_fixture_id === '1001').id;
  assert.ok(s.db.table('odds_snapshots').every((o) => o.fixture_id === ev1Fixture));
  assert.equal(s.db.table('odds_event_links')[0].fixture_id, ev1Fixture);
  assert.deepEqual(s.db.table('odds_events').map((e) => e.provider_event_id).sort(), ['ev1', 'uel1']);
  assert.equal(s.db.table('teams').find((t) => t.name === 'Manchester United FC').short_name, 'Man United');
  const oddsMap = s.db.table('provider_team_map').filter((m) => m.source_provider === 'the_odds_api').map((m) => m.provider_name).sort();
  assert.deepEqual(oddsMap, ['Arsenal', 'Manchester United']);
});

test('credit-budget refusal skips odds for that competition without failing the run', async () => {
  const s = setup({ budgetDenied: true });
  const report = await dailySync({ fd: s.fd, odds: s.odds, repo: s.repo, now: () => NOW });
  const epl = report.find((r) => r.code === 'EPL');
  assert.equal(epl.odds, 'SKIPPED_MONTHLY_BUDGET_RESERVE');
  assert.equal(epl.error, undefined);
  assert.equal(s.db.table('odds_snapshots').length, 0);
});

test('re-running the same day appends a new odds snapshot batch and keeps fixtures unique', async () => {
  const s = setup();
  await dailySync({ fd: s.fd, odds: s.odds, repo: s.repo, now: () => NOW });
  await dailySync({ fd: s.fd, odds: s.odds, repo: s.repo, now: () => NOW });
  assert.equal(s.db.table('fixtures').length, 3);
  assert.equal(s.db.table('odds_snapshots').length, 6);
  assert.equal(new Set(s.db.table('odds_snapshots').map((o) => o.capture_batch_id)).size, 2);
});

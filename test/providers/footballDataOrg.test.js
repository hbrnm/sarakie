'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFootballDataOrgAdapter, normalizeMatch } = require('../../src/providers/footballDataOrg');
const { createHttpClient } = require('../../src/providers/http');
const { createFakeFetch, noSleep, noWait } = require('./fakes');

const match = (over = {}) => ({
  id: 1001,
  utcDate: '2026-10-18T14:00:00Z',
  status: 'TIMED',
  matchday: 8,
  stage: 'REGULAR_SEASON',
  season: { startDate: '2026-08-21' },
  homeTeam: { id: 62, name: 'Everton FC', shortName: 'Everton', tla: 'EVE' },
  awayTeam: { id: 61, name: 'Chelsea FC', shortName: 'Chelsea', tla: 'CHE' },
  score: { duration: 'REGULAR', fullTime: { home: null, away: null } },
  ...over,
});

const COMPETITIONS = [
  { id: 2021, code: 'PL', name: 'Premier League', area: { name: 'England' }, currentSeason: { startDate: '2026-08-21' } },
  { id: 2016, code: 'ELC', name: 'Championship', area: { name: 'England' } },
  { id: 2014, code: 'PD', name: 'Primera Division', area: { name: 'Spain' } },
  { id: 2019, code: 'SA', name: 'Serie A', area: { name: 'Italy' } },
  { id: 9999, code: 'SAB', name: 'Serie A', area: { name: 'Brazil' } },
  { id: 2002, code: 'BL1', name: 'Bundesliga', area: { name: 'Germany' } },
  { id: 2015, code: 'FL1', name: 'Ligue 1', area: { name: 'France' } },
  { id: 2001, code: 'CL', name: 'UEFA Champions League', area: { name: 'Europe' } },
];

function adapter(routes) {
  const fake = createFakeFetch({ '/v4/competitions': { body: { competitions: COMPETITIONS } }, ...routes });
  const http = createHttpClient({ provider: 'football_data_org', fetchImpl: fake.fetchImpl, sleep: noSleep, secrets: ['KEY'] });
  return { a: createFootballDataOrgAdapter({ apiKey: 'KEY', http, limiter: noWait }), fake };
}

test('discovers competitions by name and area, not by hard-coded IDs', async () => {
  const { a } = adapter({});
  const found = await a.listCompetitions();
  const byCode = Object.fromEntries(found.map((c) => [c.competitionCode, c.providerCompetitionId]));
  assert.deepEqual(byCode, { EPL: '2021', LALIGA: '2014', SERIEA: '2019', BUNDESLIGA: '2002', LIGUE1: '2015', UCL: '2001' });
  assert.equal(found.find((c) => c.competitionCode === 'EPL').currentSeason, 2026);
});

test('missing competition (e.g. UEL on free tier) is reported as NO_PROVIDER_COVERAGE', async () => {
  const { a } = adapter({});
  await assert.rejects(a.listFixtures({ competitionCode: 'UEL', from: '2026-10-15', to: '2026-10-22' }), (e) => e.code === 'NO_PROVIDER_COVERAGE');
});

test('normalizes fixtures and sends the auth header', async () => {
  const { a, fake } = adapter({ '/v4/competitions/2021/matches': { body: { matches: [match()] } } });
  const { fixtures, report } = await a.listFixtures({ competitionCode: 'EPL', from: '2026-10-15', to: '2026-10-22' });
  assert.equal(report.accepted, 1);
  assert.deepEqual(fixtures[0], {
    sourceProvider: 'football_data_org',
    providerFixtureId: '1001',
    competitionCode: 'EPL',
    season: 2026,
    kickoffUtc: '2026-10-18T14:00:00.000Z',
    status: 'SCHEDULED',
    home: { providerTeamId: '62', name: 'Everton FC', shortName: 'Everton', tla: 'EVE' },
    away: { providerTeamId: '61', name: 'Chelsea FC', shortName: 'Chelsea', tla: 'CHE' },
    homeGoals: null,
    awayGoals: null,
    matchday: 8,
    stage: 'REGULAR_SEASON',
  });
  const call = fake.calls.find((c) => c.url.pathname.endsWith('/matches'));
  assert.equal(call.headers['X-Auth-Token'], 'KEY');
  assert.equal(call.url.searchParams.get('dateFrom'), '2026-10-15');
});

test('finished matches use regular-time score; extra time is excluded', () => {
  const r = normalizeMatch(match({ status: 'FINISHED', score: { duration: 'EXTRA_TIME', fullTime: { home: 3, away: 2 }, regularTime: { home: 2, away: 2 } } }), 'UCL');
  assert.equal(r.fixture.homeGoals, 2);
  assert.equal(r.fixture.awayGoals, 2);
});

test('invalid or unusable matches are dropped with reasons', () => {
  assert.equal(normalizeMatch({ id: 'x' }, 'EPL').reason, 'SCHEMA_INVALID');
  assert.equal(normalizeMatch(match({ status: 'WEIRD' }), 'EPL').reason, 'UNKNOWN_STATUS');
  assert.equal(normalizeMatch(match({ homeTeam: { id: null, name: null } }), 'UCL').reason, 'TEAMS_TBD');
  assert.equal(normalizeMatch(match({ status: 'FINISHED' }), 'EPL').reason, 'FINISHED_WITHOUT_SCORE');
  assert.equal(normalizeMatch(match({ utcDate: 'not a date' }), 'EPL').reason, 'SCHEMA_INVALID');
});

test('status mapping', () => {
  const s = (status) => normalizeMatch(match({ status, score: { fullTime: { home: 1, away: 0 } } }), 'EPL').fixture.status;
  assert.equal(s('SCHEDULED'), 'SCHEDULED');
  assert.equal(s('IN_PLAY'), 'LIVE');
  assert.equal(s('SUSPENDED'), 'POSTPONED');
  assert.equal(s('FINISHED'), 'FINISHED');
  assert.equal(s('AWARDED'), 'AWARDED');
});

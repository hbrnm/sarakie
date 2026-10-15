'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepositories, createSupabaseCreditStore } = require('../../src/persistence/repositories');
const { createCreditBudget } = require('../../src/providers/oddsApi/creditBudget');
const { createFakeDb } = require('./fakeDb');

let n = 0;
const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
const NOW = new Date('2026-10-15T08:00:00Z');

const fixture = (id, home, away, over = {}) => ({
  sourceProvider: 'football_data_org', providerFixtureId: id, competitionCode: 'EPL', season: 2026,
  kickoffUtc: '2026-10-18T14:00:00.000Z', status: 'SCHEDULED', home: { providerTeamId: home }, away: { providerTeamId: away },
  homeGoals: null, awayGoals: null, matchday: 8, stage: null, ...over,
});
const quote = (eventId, sel, odds, over = {}) => ({
  sourceProvider: 'the_odds_api', providerEventId: eventId, bookmakerKey: 'pinnacle', bookmakerName: 'Pinnacle',
  marketCode: '1X2', selectionCode: sel, line: null, decimalOdds: odds, kind: 'pre_match',
  sourceTimestamp: null, capturedAt: NOW.toISOString(), ...over,
});

test('primary teams are created once and reused', async () => {
  const db = createFakeDb();
  const repo = createRepositories(db, { now: () => NOW, uuid });
  const teams = [{ providerTeamId: '57', name: 'Arsenal FC' }, { providerTeamId: '61', name: 'Chelsea FC' }];
  const first = await repo.ensurePrimaryTeams('football_data_org', teams);
  const second = await repo.ensurePrimaryTeams('football_data_org', [...teams, { providerTeamId: '62', name: 'Everton FC' }]);
  assert.equal(db.table('teams').length, 3);
  assert.equal(second.get('57'), first.get('57'));
  assert.equal(db.table('provider_team_map').every((r) => r.match_method === 'primary'), true);
});

test('fixtures are upserted on the provider key; unknown teams are skipped', async () => {
  const db = createFakeDb();
  const repo = createRepositories(db, { now: () => NOW, uuid });
  const ids = await repo.ensurePrimaryTeams('football_data_org', [{ providerTeamId: '57', name: 'A' }, { providerTeamId: '61', name: 'C' }]);
  const r1 = await repo.upsertFixtures([fixture('1001', '57', '61'), fixture('1002', '57', '999')], ids);
  assert.equal(r1.saved.size, 1);
  assert.equal(r1.skipped, 1);
  await repo.upsertFixtures([fixture('1001', '57', '61', { status: 'FINISHED', homeGoals: 2, awayGoals: 1 })], ids);
  const rows = db.table('fixtures');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'FINISHED');
  assert.equal(rows[0].home_goals, 2);
});

test('odds snapshots are inserted with bookmaker ids, fixture links and one batch id', async () => {
  const db = createFakeDb();
  const repo = createRepositories(db, { now: () => NOW, uuid });
  const r = await repo.insertOddsSnapshots([quote('e1', 'HOME', 2.1), quote('e1', 'DRAW', 3.4), quote('e2', 'HOME', 1.9)], {
    fixtureIdByEvent: new Map([['e1', 'fx-1']]),
  });
  const rows = db.table('odds_snapshots');
  assert.equal(r.inserted, 3);
  assert.equal(new Set(rows.map((x) => x.capture_batch_id)).size, 1);
  assert.deepEqual(rows.map((x) => x.fixture_id), ['fx-1', 'fx-1', null]);
  assert.equal(db.table('bookmakers').length, 1);
  assert.equal(rows[0].bookmaker_id, db.table('bookmakers')[0].id);
});

test('closing-odds import is idempotent per provider event', async () => {
  const db = createFakeDb();
  const repo = createRepositories(db, { now: () => NOW, uuid });
  const q = [quote('csv-1', 'HOME', 2, { sourceProvider: 'football_data_co_uk', kind: 'closing' })];
  await repo.insertOddsSnapshots(q, { skipExistingEvents: true });
  const again = await repo.insertOddsSnapshots(q, { skipExistingEvents: true });
  assert.equal(again.inserted, 0);
  assert.equal(again.skippedEvents, 1);
  assert.equal(db.table('odds_snapshots').length, 1);
});

test('mixed providers in one snapshot batch are rejected', async () => {
  const repo = createRepositories(createFakeDb(), { now: () => NOW, uuid });
  await assert.rejects(repo.insertOddsSnapshots([quote('e1', 'HOME', 2), quote('e2', 'HOME', 2, { sourceProvider: 'x' })]));
});

test('request log strips query strings', async () => {
  const db = createFakeDb();
  const repo = createRepositories(db, { now: () => NOW, uuid });
  await repo.insertRequestLog([{ provider: 'the_odds_api', endpoint: '/v4/sports?apiKey=SECRET', status: 200, at: NOW }]);
  assert.equal(db.table('provider_request_log')[0].endpoint, '/v4/sports');
});

test('Supabase credit store drives the budget across instances', async () => {
  const db = createFakeDb();
  const now = () => NOW;
  const b1 = createCreditBudget({ store: createSupabaseCreditStore(db), now });
  await b1.record('on_demand', 150, 300);
  const b2 = createCreditBudget({ store: createSupabaseCreditStore(db), now }); // e.g. next job run
  assert.equal((await b2.check('on_demand', 51)).reason, 'ON_DEMAND_CAP');
  const usage = await b2.usage();
  assert.equal(usage.on_demand, 150);
  assert.equal(usage.providerRemaining, 300);
});

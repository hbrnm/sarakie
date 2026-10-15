'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOddsApiAdapter, mapSelection } = require('../../src/providers/oddsApi');
const { createCreditBudget } = require('../../src/providers/oddsApi/creditBudget');
const { createHttpClient } = require('../../src/providers/http');
const { createFakeFetch, noSleep } = require('./fakes');

const SPORTS = [
  { key: 'soccer_epl', group: 'Soccer', title: 'EPL', active: true, has_outrights: false },
  { key: 'soccer_epl_winner', group: 'Soccer', title: 'EPL Winner', active: true, has_outrights: true },
  { key: 'soccer_germany_bundesliga', group: 'Soccer', title: 'Bundesliga - Germany', has_outrights: false },
  { key: 'soccer_germany_bundesliga2', group: 'Soccer', title: 'Bundesliga 2 - Germany', has_outrights: false },
  { key: 'soccer_spain_la_liga', group: 'Soccer', title: 'La Liga - Spain', has_outrights: false },
  { key: 'soccer_spain_segunda_division', group: 'Soccer', title: 'La Liga 2 - Spain', has_outrights: false },
  { key: 'soccer_uefa_champs_league', group: 'Soccer', title: 'UEFA Champions League', has_outrights: false },
  { key: 'basketball_nba', group: 'Basketball', title: 'NBA', has_outrights: false },
];

const event = {
  id: 'ev1',
  sport_key: 'soccer_epl',
  commence_time: '2026-10-18T14:00:00Z',
  home_team: 'Everton',
  away_team: 'Chelsea',
  bookmakers: [
    {
      key: 'pinnacle',
      title: 'Pinnacle',
      last_update: '2026-10-15T05:40:00Z',
      markets: [
        { key: 'h2h', last_update: '2026-10-15T05:41:00Z', outcomes: [{ name: 'Everton', price: 3.1 }, { name: 'Chelsea', price: 2.3 }, { name: 'Draw', price: 3.4 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: 1.9, point: 2.5 }, { name: 'Under', price: 1.95, point: 2.5 }, { name: 'Over', price: 2.2, point: 2.75 }] },
        { key: 'h2h_h1', outcomes: [{ name: 'Draw', price: 2.1 }] },
      ],
    },
    { key: 'badbook', title: 'Bad', markets: [{ key: 'h2h', outcomes: [{ name: 'Everton', price: 1.0 }, { name: 'Someone', price: 2 }] }] },
  ],
};

function setup({ budget = createCreditBudget(), routes = {} } = {}) {
  const fake = createFakeFetch({
    '/v4/sports': { body: SPORTS },
    '/v4/sports/soccer_epl/odds': { body: [event], headers: { 'x-requests-last': '2', 'x-requests-remaining': '480' } },
    ...routes,
  });
  const http = createHttpClient({ provider: 'the_odds_api', fetchImpl: fake.fetchImpl, sleep: noSleep, secrets: ['OKEY'] });
  const a = createOddsApiAdapter({ apiKey: 'OKEY', budget, http, now: () => new Date('2026-10-15T06:00:00Z') });
  return { a, fake, budget };
}

test('discovers soccer competitions, excluding outrights, second divisions and other sports', async () => {
  const { a } = setup();
  const found = Object.fromEntries((await a.listCompetitions()).map((c) => [c.competitionCode, c.providerCompetitionId]));
  assert.deepEqual(found, { EPL: 'soccer_epl', BUNDESLIGA: 'soccer_germany_bundesliga', LALIGA: 'soccer_spain_la_liga', UCL: 'soccer_uefa_champs_league' });
});

test('featured odds are normalized; out-of-scope lines, markets and invalid odds are dropped', async () => {
  const { a, budget } = setup();
  const r = await a.getFeaturedOdds({ competitionCode: 'EPL' });
  const pin = r.quotes.filter((q) => q.bookmakerKey === 'pinnacle');
  assert.deepEqual(pin.map((q) => `${q.marketCode}:${q.selectionCode}:${q.line}:${q.decimalOdds}`), [
    '1X2:HOME:null:3.1', '1X2:AWAY:null:2.3', '1X2:DRAW:null:3.4', 'OU:OVER:2.5:1.9', 'OU:UNDER:2.5:1.95',
  ]);
  assert.equal(pin[0].sourceTimestamp, '2026-10-15T05:41:00Z');
  assert.equal(pin[3].sourceTimestamp, '2026-10-15T05:40:00Z');
  assert.equal(pin[0].capturedAt, '2026-10-15T06:00:00.000Z');
  assert.equal(pin[0].kickoffUtc, '2026-10-18T14:00:00.000Z');
  assert.deepEqual(r.report.dropped, { OU_LINE_OUT_OF_SCOPE: 1, ODDS_INVALID: 1, UNMAPPED_SELECTION: 1 });
  assert.equal(r.events.length, 1);
  const usage = await budget.usage();
  assert.equal(usage.scanner, 2);
  assert.equal(usage.providerRemaining, 480);
});

test('API key never appears in the URL path, only as query parameter', async () => {
  const { a, fake } = setup();
  await a.getFeaturedOdds({ competitionCode: 'EPL' });
  const call = fake.calls.find((c) => c.url.pathname.endsWith('/odds'));
  assert.equal(call.url.searchParams.get('apiKey'), 'OKEY');
  assert.ok(!call.url.pathname.includes('OKEY'));
  assert.equal(call.url.searchParams.get('regions'), 'eu');
});

test('budget refusal prevents the request entirely', async () => {
  const budget = createCreditBudget({ monthlyLimit: 10, reserve: 9 });
  const { a, fake } = setup({ budget });
  await assert.rejects(a.getFeaturedOdds({ competitionCode: 'EPL' }), (e) => e.code === 'CREDIT_BUDGET' && e.reason === 'MONTHLY_BUDGET_RESERVE');
  assert.equal(fake.calls.filter((c) => c.url.pathname.endsWith('/odds')).length, 0);
});

test('selection mapping for all markets', () => {
  assert.equal(mapSelection('1X2', 'Everton', 'Everton', 'Chelsea'), 'HOME');
  assert.equal(mapSelection('1X2', 'draw', 'Everton', 'Chelsea'), 'DRAW');
  assert.equal(mapSelection('DNB', 'Chelsea', 'Everton', 'Chelsea'), 'AWAY');
  assert.equal(mapSelection('DNB', 'Draw', 'Everton', 'Chelsea'), null);
  assert.equal(mapSelection('BTTS', 'Yes', 'Everton', 'Chelsea'), 'YES');
  assert.equal(mapSelection('OU', 'Under', 'Everton', 'Chelsea'), 'UNDER');
  assert.equal(mapSelection('DC', 'Everton/Draw', 'Everton', 'Chelsea'), '1X');
  assert.equal(mapSelection('DC', 'Draw/Chelsea', 'Everton', 'Chelsea'), 'X2');
  assert.equal(mapSelection('DC', 'Everton/Chelsea', 'Everton', 'Chelsea'), '12');
  assert.equal(mapSelection('DC', 'Home or Draw', 'Everton', 'Chelsea'), '1X');
  assert.equal(mapSelection('DC', 'Everton', 'Everton', 'Chelsea'), null);
});

test('event odds use on-demand purpose and requested markets', async () => {
  const { a, fake, budget } = setup({
    routes: {
      '/v4/sports/soccer_epl/events/ev1/odds': {
        body: { ...event, bookmakers: [{ key: 'b', title: 'B', markets: [{ key: 'btts', outcomes: [{ name: 'Yes', price: 1.8 }, { name: 'No', price: 2.0 }] }, { key: 'alternate_totals', outcomes: [{ name: 'Over', price: 1.3, point: 1.5 }, { name: 'Under', price: 3.4, point: 1.5 }, { name: 'Over', price: 1.5, point: 2 }] }] }] },
        headers: { 'x-requests-last': '2' },
      },
    },
  });
  const r = await a.getEventOdds({ competitionCode: 'EPL', providerEventId: 'ev1', markets: ['btts', 'alternate_totals'] });
  assert.deepEqual(r.quotes.map((q) => `${q.marketCode}:${q.selectionCode}:${q.line}`), ['BTTS:YES:null', 'BTTS:NO:null', 'OU:OVER:1.5', 'OU:UNDER:1.5']);
  assert.equal((await budget.usage()).on_demand, 2);
  const call = fake.calls.find((c) => c.url.pathname.includes('/events/'));
  assert.equal(call.url.searchParams.get('markets'), 'btts,alternate_totals');
});

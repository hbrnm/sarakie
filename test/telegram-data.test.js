'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot } = require('../src/telegram/bot');
const { fixturesMessages, parseLeague } = require('../src/telegram/messages');
const { createQueries } = require('../src/persistence/queries');
const { createCreditBudget } = require('../src/providers/oddsApi/creditBudget');
const { createSupabaseCreditStore } = require('../src/persistence/repositories');
const { createFakeDb } = require('./persistence/fakeDb');
const { VALID_ENV, createMemoryLogger, stubTelegram, messageUpdate } = require('./helpers');

const NOW = new Date('2026-10-16T08:00:00Z');
const USER = 111111111;

function seed() {
  const db = createFakeDb();
  db.table('teams').push(
    { id: 't1', name: 'Arsenal FC', short_name: 'Arsenal' },
    { id: 't2', name: 'Manchester United FC', short_name: 'Man United' },
    { id: 't3', name: 'Real Madrid CF', short_name: null },
    { id: 't4', name: 'Juventus FC', short_name: 'Juventus' },
  );
  db.table('fixtures').push(
    { competition_code: 'EPL', kickoff_utc: '2026-10-18T14:00:00.000Z', status: 'SCHEDULED', home_team_id: 't1', away_team_id: 't2' },
    { competition_code: 'UCL', kickoff_utc: '2026-10-17T19:00:00.000Z', status: 'SCHEDULED', home_team_id: 't3', away_team_id: 't4' },
    { competition_code: 'EPL', kickoff_utc: '2026-10-25T14:00:00.000Z', status: 'SCHEDULED', home_team_id: 't2', away_team_id: 't1' },
    { competition_code: 'EPL', kickoff_utc: '2026-10-17T14:00:00.000Z', status: 'POSTPONED', home_team_id: 't2', away_team_id: 't1' },
  );
  db.table('odds_events').push({ competition_code: 'UEL', kickoff_utc: '2026-10-17T16:45:00.000Z', home_team_name: 'Roma', away_team_name: 'Ajax' });
  db.table('odds_credit_ledger').push({ month: '2026-10', purpose: 'scanner', credits: 12, provider_remaining: 445, recorded_at: '2026-10-16T07:18:00Z' });
  db.table('provider_request_log').push({ source_provider: 'football_data_org', requested_at: '2026-10-16T07:17:30.000Z' });
  return db;
}

function botWith(t, db) {
  const queries = createQueries(db, { now: () => NOW });
  const budget = createCreditBudget({ store: createSupabaseCreditStore(db), now: () => NOW });
  const data = db
    ? { upcoming: (q) => queries.upcoming(q), quota: () => queries.quota({ budget }), ping: () => queries.ping(), latestDigest: () => queries.latestDigest(), lastScan: () => queries.lastScan() }
    : null;
  const { logger } = createMemoryLogger();
  const bot = createBot({ token: VALID_ENV.TELEGRAM_BOT_TOKEN, allowedUserIds: new Set([USER]), logger, getStatus: () => ({ version: '0.1.0', uptimeSeconds: 5, now: NOW }), data, now: () => NOW });
  return { bot, calls: stubTelegram(bot, t) };
}

test('/fixtures lists the next 3 days for all competitions, Bucharest time, UEFA marked informational', async (t) => {
  const { bot, calls } = botWith(t, seed());
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/fixtures' }));
  const text = calls.map((c) => c.payload.text).join('\n');
  assert.match(text, /următoarele 3 zile/);
  assert.match(text, /Arsenal – Man United/);
  assert.match(text, /17:00 — Arsenal/); // 14:00 UTC = 17:00 EEST
  assert.match(text, /UEFA Champions League \(informativ/);
  assert.match(text, /Real Madrid CF – Juventus/); // falls back to full name
  assert.match(text, /UEFA Europa League \(informativ[\s\S]*Roma – Ajax/);
  assert.doesNotMatch(text, /25\.10/); // outside 3 days
});

test('/fixtures <league> filters to one competition over 7 days; postponed matches are hidden', async (t) => {
  const { bot, calls } = botWith(t, seed());
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/fixtures Premier' }));
  const text = calls[0].payload.text;
  assert.match(text, /Premier League — următoarele 7 zile/);
  assert.equal((text.match(/•/g) || []).length, 1); // 18.10 only: 25.10 is beyond 7 days, 17.10 is postponed
  assert.doesNotMatch(text, /25\.10/);
  assert.doesNotMatch(text, /Champions/);
});

test('/fixtures with unknown league explains the options', async (t) => {
  const { bot, calls } = botWith(t, seed());
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/fixtures mls' }));
  assert.match(calls[0].payload.text, /nu este recunoscută/);
});

test('/quota reports credits and requests', async (t) => {
  const { bot, calls } = botWith(t, seed());
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/quota' }));
  const text = calls[0].payload.text;
  assert.match(text, /Credite folosite: 12 din 500/);
  assert.match(text, /rămase raportate de furnizor: 445/);
  assert.match(text, /football-data.org: 1/);
});

test('without a database the data commands answer gracefully', async (t) => {
  const { bot, calls } = botWith(t, null);
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/fixtures' }));
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/quota' }));
  assert.ok(calls.every((c) => /nu sunt disponibile/.test(c.payload.text)));
});

test('a failing database query is logged and answered, not crashed', async (t) => {
  const db = seed();
  db.from = () => { throw new Error('connection refused'); };
  const { bot, calls } = botWith(t, db);
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/fixtures' }));
  assert.match(calls[0].payload.text, /nu sunt disponibile/);
});

test('league aliases and long lists are split under the Telegram limit', () => {
  assert.equal(parseLeague('Serie-A'), 'SERIEA');
  assert.equal(parseLeague('UCL'), 'UCL');
  assert.equal(parseLeague('nba'), null);
  const many = Array.from({ length: 300 }, (_, i) => ({ competitionCode: 'EPL', kickoffUtc: '2026-10-18T14:00:00Z', home: `Home ${i}`, away: `Away ${i}` }));
  const chunks = fixturesMessages(many, { days: 7 });
  assert.ok(chunks.length > 1); // a single oversized competition block is split by lines
  assert.ok(chunks.every((c) => c.length <= 4096));
  assert.equal(chunks.join('\n').match(/•/g).length, 300); // nothing lost
  const mixed = ['EPL', 'LALIGA', 'SERIEA', 'BUNDESLIGA', 'LIGUE1'].flatMap((c) => Array.from({ length: 60 }, (_, i) => ({ competitionCode: c, kickoffUtc: '2026-10-18T14:00:00Z', home: `Home ${i}`, away: `Away ${i}` })));
  const parts = fixturesMessages(mixed, { days: 7 });
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 4096));
});

test('/health reports database status: connected, not configured, error', async (t) => {
  const db = seed();
  db.table('competitions').push(...['EPL', 'LALIGA', 'SERIEA', 'BUNDESLIGA', 'LIGUE1', 'UCL', 'UEL'].map((code) => ({ code })));
  let r = botWith(t, db);
  await r.bot.handleUpdate(messageUpdate({ userId: USER, text: '/health' }));
  assert.match(r.calls[0].payload.text, /Bază de date: conectată \(7 competiții\)/);

  r = botWith(t, null);
  await r.bot.handleUpdate(messageUpdate({ userId: USER, text: '/health' }));
  assert.match(r.calls.at(-1).payload.text, /Bază de date: neconfigurată/);

  const broken = seed();
  broken.from = () => { throw new Error('connection refused'); };
  r = botWith(t, broken);
  await r.bot.handleUpdate(messageUpdate({ userId: USER, text: '/health' }));
  assert.match(r.calls.at(-1).payload.text, /Bază de date: eroare de conexiune/);
});

test('/scan re-sends the latest stored digest (split if long) and never re-runs the scanner', async (t) => {
  const db = seed();
  db.table('scan_digests').push(
    { scan_date: '2026-10-15', text: 'vechi' },
    { scan_date: '2026-10-16', text: `FVIS — scanare zilnică 2026-10-16\n${'linie lungă\n'.repeat(400)}final` },
  );
  const { bot, calls } = botWith(t, db);
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/scan' }));
  assert.ok(calls.length >= 2);
  assert.match(calls[0].payload.text, /^FVIS — scanare zilnică 2026-10-16/);
  assert.match(calls.at(-1).payload.text, /final$/);
  assert.ok(calls.every((c) => c.payload.text.length <= 4096));
  assert.equal(db.table('analysis_runs').length, 0);
});

test('/scan without any digest says so', async (t) => {
  const { bot, calls } = botWith(t, seed());
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/scan' }));
  assert.match(calls[0].payload.text, /Nu există încă niciun rezumat/);
});

test('/health shows the last finished scanner run', async (t) => {
  const db = seed();
  db.table('competitions').push({ code: 'EPL' });
  db.table('analysis_runs').push(
    { trigger: 'scanner', scan_date: '2026-10-15', status: 'OK', started_at: '2026-10-15T07:20:00Z', finished_at: '2026-10-15T07:21:00Z' },
    { trigger: 'on_demand', scan_date: null, status: 'OK', started_at: '2026-10-16T09:00:00Z', finished_at: '2026-10-16T09:00:05Z' },
    { trigger: 'scanner', scan_date: '2026-10-16', status: 'RUNNING', started_at: '2026-10-16T07:20:00Z', finished_at: null },
  );
  const { bot, calls } = botWith(t, db);
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/health' }));
  assert.match(calls[0].payload.text, /Ultima scanare: 2026-10-15 \(OK\)/);
});

test('/analyze passes the full argument text (team names with spaces) and splits long replies', async (t) => {
  const db = seed();
  const seen = [];
  const queries = createQueries(db, { now: () => NOW });
  const { logger } = createMemoryLogger();
  const data = { upcoming: (q) => queries.upcoming(q), analyze: async (text) => { seen.push(text); return `rezultat\n${'x'.repeat(5000)}`; } };
  const bot = createBot({ token: VALID_ENV.TELEGRAM_BOT_TOKEN, allowedUserIds: new Set([USER]), logger, getStatus: () => ({ version: '0.1.0', uptimeSeconds: 5, now: NOW }), data, now: () => NOW });
  const calls = stubTelegram(bot, t);
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/analyze Real Madrid - Atlético Madrid' }));
  assert.deepEqual(seen, ['Real Madrid - Atlético Madrid']);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((c) => c.payload.text.length <= 4096));
});

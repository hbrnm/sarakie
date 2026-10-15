'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { todayReport, bucharestDay } = require('../../src/pipeline/today');
const { scan } = require('../../src/jobs/scan');
const { seed } = require('./seed');
const { NOW, FIXTURE } = require('../risk/helpers');

test('bucharestDay covers the local calendar day, including the DST change', () => {
  const d = bucharestDay(new Date('2026-10-15T21:30:00Z')); // 00:30 local on 16.10
  assert.equal(d.label, '16.10.2026');
  assert.equal(d.start.toISOString(), '2026-10-15T21:00:00.000Z');
  assert.equal(d.end.toISOString(), '2026-10-16T21:00:00.000Z');
  const dst = bucharestDay(new Date('2026-10-25T10:00:00Z')); // 25 hours long
  assert.equal(dst.start.toISOString(), '2026-10-24T21:00:00.000Z');
  assert.equal(dst.end.toISOString(), '2026-10-25T22:00:00.000Z');
});

test('/azi lists the day: latest stored analysis for league matches, market view for cups, 0 credits', async () => {
  const { fake, store } = seed();
  await scan({ store, sender: { send: async () => {} }, chatIds: [1], now: () => NOW });
  for (const p of fake.table('predictions')) p.created_at = NOW.toISOString(); // set by the database default in production
  fake.table('odds_events').push({ source_provider: 'the_odds_api', provider_event_id: 'uel-1', competition_code: 'UEL', kickoff_utc: FIXTURE.kickoffUtc, home_team_name: 'Benfica', away_team_name: 'Celtic' });
  fake.table('bookmakers').push({ id: 77, source_provider: 'the_odds_api', provider_bookmaker_key: 'x', name: 'X' });
  [['HOME', 1.3], ['DRAW', 5.5], ['AWAY', 10]].forEach(([sel, o], i) =>
    fake.table('odds_snapshots').push({ id: 7000 + i, fixture_id: null, source_provider: 'the_odds_api', provider_event_id: 'uel-1', bookmaker_id: 77, market_code: '1X2', selection_code: sel, line: null, decimal_odds: o, kind: 'pre_match', source_timestamp: null, captured_at: NOW.toISOString() }),
  );
  const before = fake.table('predictions').length;
  const text = await todayReport({ store, now: () => NOW }, { tomorrow: true });
  assert.match(text, /^FVIS — meciurile de mâine, \d\d\.\d\d\.\d{4}/);
  assert.match(text, /Premier League\n• \d\d:\d\d Home FC – Team T02/);
  assert.match(text, /de urmărit \(WATCHLIST\): Peste 2\.5 goluri · cotă \d+\.\d\d · model \d+\.\d% · EV \+\d+\.\d%\n {4}condiții neîndeplinite: QUALIFIED suspendat/);
  assert.match(text, /\(scanare, \d\d:\d\d\)/);
  assert.match(text, /CUPE EUROPENE — DOAR PIAȚA \(informativ\)\n• UEFA Europa League · .* — Benfica – Celtic/);
  assert.equal(fake.table('predictions').length, before);

  const today = await todayReport({ store, now: () => NOW });
  assert.match(today, /Niciun meci în competițiile urmărite/);
});

test('/azi: a fixture without a stored analysis points to /analyze', async () => {
  const { store } = seed();
  const text = await todayReport({ store, now: () => NOW }, { tomorrow: true });
  assert.match(text, /neanalizat încă — \/analyze/);
});

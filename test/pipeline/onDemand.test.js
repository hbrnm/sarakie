'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnDemandAnalyzer, parseMatchQuery, EVENT_MARKETS } = require('../../src/pipeline/onDemand');
const { createRepositories } = require('../../src/persistence/repositories');
const { seed, FIXTURE_ID } = require('./seed');
const { NOW, FIXTURE, EST, quote } = require('../risk/helpers');

/** A complete book for every in-scope market at model-fair prices with a margin. */
function fullBook(key, capturedAt, margin = 0.05) {
  const m = EST.markets;
  const out = [];
  const add = (market, sel, line, fair) => out.push(quote(key, market, sel, line, Math.round((fair / (1 + margin)) * 100) / 100, { capturedAt }));
  for (const s of ['HOME', 'DRAW', 'AWAY']) add('1X2', s, null, 1 / m['1X2'][s].p);
  for (const s of ['1X', '12', 'X2']) add('DC', s, null, 1 / m.DC[s].p);
  for (const s of ['HOME', 'AWAY']) add('DNB', s, null, m.DNB[s].fairOdds);
  for (const line of [1.5, 2.5, 3.5]) for (const s of ['OVER', 'UNDER']) add('OU', s, line, 1 / m.OU[line][s].p);
  for (const s of ['YES', 'NO']) add('BTTS', s, null, 1 / m.BTTS[s].p);
  return out.map((q) => ({ ...q, providerEventId: 'ev-od', competitionCode: 'EPL', kickoffUtc: FIXTURE.kickoffUtc, homeTeamName: 'Home FC', awayTeamName: 'Team T02' }));
}

function fakeOdds({ fail = null } = {}) {
  const calls = { events: 0, eventOdds: [] };
  return {
    calls,
    source: 'the_odds_api',
    async listEvents() {
      calls.events += 1;
      return { events: [{ providerEventId: 'ev-od', competitionCode: 'EPL', kickoffUtc: FIXTURE.kickoffUtc, homeTeamName: 'Home FC', awayTeamName: 'Team T02' }], credits: { last: 0 } };
    },
    async getEventOdds(args) {
      calls.eventOdds.push(args);
      if (fail) throw fail;
      await new Promise((r) => setImmediate(r));
      const quotes = ['b1', 'b2', 'b3'].flatMap((k) => fullBook(k, NOW.toISOString()));
      return { quotes, events: [{ providerEventId: 'ev-od', competitionCode: 'EPL', kickoffUtc: FIXTURE.kickoffUtc, homeTeamName: 'Home FC', awayTeamName: 'Team T02' }], credits: { last: 6, remaining: 400 } };
    },
  };
}

function setup(opts = {}) {
  const { fake, store } = seed({ quotes: [] });
  const odds = opts.odds === undefined ? fakeOdds() : opts.odds;
  const usage = async () => ({ on_demand: 6, onDemandMonthlyCap: 200 });
  const analyzer = createOnDemandAnalyzer({ store, repo: createRepositories(fake), odds, budget: { usage }, now: () => opts.now || NOW });
  return { fake, store, odds, analyzer };
}

test('parseMatchQuery: separators, two words, single team, garbage', () => {
  assert.deepEqual(parseMatchQuery('Real Madrid - Barcelona'), { home: 'Real Madrid', away: 'Barcelona' });
  assert.deepEqual(parseMatchQuery('Man United vs Chelsea'), { home: 'Man United', away: 'Chelsea' });
  assert.deepEqual(parseMatchQuery('Arsenal  Chelsea'), { home: 'Arsenal', away: 'Chelsea', whole: 'Arsenal Chelsea' });
  assert.deepEqual(parseMatchQuery('Saint-Étienne – Lyon'), { home: 'Saint-Étienne', away: 'Lyon' });
  assert.deepEqual(parseMatchQuery('Bayern'), { team: 'Bayern' });
  assert.equal(parseMatchQuery(''), null);
  assert.equal(parseMatchQuery('a - b - c'), null);
});

test('/analyze fetches every market once (D-16), analyses on demand and records predictions', async () => {
  const { fake, odds, analyzer } = setup();
  const text = await analyzer.analyze('Home FC - Team T02');
  assert.equal(odds.calls.events, 1); // event not linked yet → events list (free), then linked
  assert.deepEqual(odds.calls.eventOdds.map((c) => [c.providerEventId, c.purpose, c.markets]), [['ev-od', 'on_demand', [...EVENT_MARKETS]]]);
  assert.equal(fake.table('odds_event_links')[0].fixture_id, FIXTURE_ID);
  assert.match(text, /Premier League: Home FC – Team T02/);
  assert.match(text, /Cote: cote descărcate acum \(6 credite\)\. Credite la cerere luna aceasta: 6 din 200\./);
  const preds = fake.table('predictions');
  assert.equal(preds.length, 16);
  assert.ok(preds.every((p) => p.mode === 'on_demand'));
  assert.ok(!preds.some((p) => p.reason_codes.includes('ODDS_NOT_FETCHED')));
  assert.equal(preds.find((p) => p.market_code === 'BTTS' && p.selection_code === 'YES').status, 'NO_VALUE');
  const run = fake.table('analysis_runs')[0];
  assert.deepEqual([run.trigger, run.status, run.credits_used, run.scan_date], ['on_demand', 'OK', 6, null]);
  assert.equal(fake.table('explanations').length, 1);
});

test('a second /analyze within 2 h reuses the odds (0 credits); a double tap fetches once', async () => {
  const { odds, analyzer } = setup();
  const [a, b] = await Promise.all([analyzer.analyze('Home FC - Team T02'), analyzer.analyze('Home FC - Team T02')]);
  assert.equal(a, b);
  assert.equal(odds.calls.eventOdds.length, 1);
  const again = await analyzer.analyze('Home FC - Team T02');
  assert.match(again, /cote refolosite/);
  assert.equal(odds.calls.eventOdds.length, 1);
});

test('reversed team order and a single team name resolve to the same fixture', async () => {
  const { analyzer } = setup();
  assert.match(await analyzer.analyze('Team T02 - Home FC'), /Home FC – Team T02/);
  assert.match(await analyzer.analyze('Home FC'), /Home FC – Team T02/);
});

test('unknown match and missing odds key are reported, never guessed', async () => {
  const { analyzer } = setup();
  assert.match(await analyzer.analyze('Nimeni - Nicaieri'), /Nu găsesc meciul/);
  const noKey = setup({ odds: null });
  const text = await noKey.analyzer.analyze('Home FC - Team T02');
  assert.match(text, /ODDS_API_KEY nu este configurat/);
  assert.match(text, /Date insuficiente|cote/);
});

test('on-demand credit cap reached → existing odds are used and the reply says so', async () => {
  const err = Object.assign(new Error('cap'), { code: 'CREDIT_BUDGET', reason: 'ON_DEMAND_CAP' });
  const { fake, analyzer } = setup({ odds: fakeOdds({ fail: err }) });
  const text = await analyzer.analyze('Home FC - Team T02');
  assert.match(text, /plafonul lunar de credite/);
  assert.equal(fake.table('analysis_runs')[0].credits_used, 0);
});

test('UCL/UEL match → market-only view from stored odds, no model, no credits, nothing recorded (D-19)', async () => {
  const { fake, odds, analyzer } = setup();
  fake.table('odds_events').push({ source_provider: 'the_odds_api', provider_event_id: 'uel-1', competition_code: 'UEL', kickoff_utc: FIXTURE.kickoffUtc, home_team_name: 'AZ Alkmaar', away_team_name: "Hapoel Be'er Sheva" });
  const bid = fake.table('bookmakers').length + 1;
  fake.table('bookmakers').push({ id: bid, source_provider: 'the_odds_api', provider_bookmaker_key: 'cupbook', name: 'CupBook' });
  [['1X2', 'HOME', null, 1.3], ['1X2', 'DRAW', null, 6], ['1X2', 'AWAY', null, 9], ['OU', 'OVER', 2.5, 1.5], ['OU', 'UNDER', 2.5, 2.6]].forEach(([m, sel, line, o], i) =>
    fake.table('odds_snapshots').push({ id: 5000 + i, fixture_id: null, source_provider: 'the_odds_api', provider_event_id: 'uel-1', bookmaker_id: bid, market_code: m, selection_code: sel, line, decimal_odds: o, kind: 'pre_match', source_timestamp: null, captured_at: NOW.toISOString() }),
  );
  const text = await analyzer.analyze('AZ - Hapoel');
  assert.match(text, /UEFA Europa League · .* — AZ Alkmaar – Hapoel Be'er Sheva/);
  assert.match(text, /piață: 1 \d+\.\d% · X \d+\.\d% · 2 \d+\.\d% · Peste 2\.5 \d+\.\d% \(1 case\)/);
  assert.match(text, /Modelul FVIS nu se aplică/);
  assert.doesNotMatch(text, /EV [+−]|ELIGIBIL|WATCHLIST/);
  assert.equal(odds.calls.eventOdds.length, 0);
  assert.equal(fake.table('predictions').length, 0);
});

test('odds older than 2 h are fetched again', async () => {
  const { fake, store, odds, analyzer } = setup();
  await analyzer.analyze('Home FC - Team T02');
  const later = createOnDemandAnalyzer({ store, repo: createRepositories(fake), odds, now: () => new Date(NOW.getTime() + 3 * 3600000) });
  assert.match(await later.analyze('Home FC - Team T02'), /cote descărcate acum/);
  assert.equal(odds.calls.eventOdds.length, 2);
  assert.equal(odds.calls.events, 1); // the event stays linked
});

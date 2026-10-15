'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeDb } = require('../persistence/fakeDb');
const { createAnalysisStore } = require('../../src/persistence/analysisStore');
const { analyzeFixture } = require('../../src/pipeline/analyzeFixture');
const { predictionRows, recordAnalysis } = require('../../src/pipeline/record');
const { estimate } = require('../../src/domain/model/estimate');
const { evaluateFixture } = require('../../src/domain/risk/evaluate');
const { MODEL_FAMILY, MODEL_VERSION, defaultConfig, configHash } = require('../../src/domain/model/config');
const { RISK_VERSION, defaultRiskConfig, riskConfigHash } = require('../../src/domain/risk/config');
const { L, NOW, FIXTURE, book } = require('../risk/helpers');

const FIXTURE_ID = 'fx-target';

/** Fake database with the synthetic league as history, the target fixture and odds. */
// Over 2.5 priced above model-fair at three books (same scenario as test/risk) → QUALIFIED.
const BOOST = { market: 'OU', sel: 'OVER', line: 2.5, factor: 1.18 };
const BOOKS = () => ['b1', 'b2', 'b3'].flatMap((k) => book(k, { margin: 0.1, boost: BOOST }));

function seed({ linkOnly = false, quotes = BOOKS() } = {}) {
  const fake = createFakeDb();
  for (const id of L.ids) fake.table('teams').push({ id, name: `Team ${id}`, short_name: id === 'T01' ? 'Home FC' : null });
  L.matches.forEach((m, i) =>
    fake.table('fixtures').push({
      id: `h${i}`, competition_code: m.competitionCode, season: m.season, kickoff_utc: m.kickoffUtc, status: 'FINISHED',
      home_team_id: m.homeTeamId, away_team_id: m.awayTeamId, home_goals: m.homeGoals, away_goals: m.awayGoals,
    }),
  );
  fake.table('fixtures').push({
    id: FIXTURE_ID, competition_code: 'EPL', season: FIXTURE.season, kickoff_utc: FIXTURE.kickoffUtc, status: 'SCHEDULED',
    home_team_id: FIXTURE.homeTeamId, away_team_id: FIXTURE.awayTeamId, home_goals: null, away_goals: null,
  });
  const keys = [...new Set(quotes.map((q) => q.bookmakerKey))];
  keys.forEach((k, i) => fake.table('bookmakers').push({ id: i + 1, source_provider: 'the_odds_api', provider_bookmaker_key: k, name: k.toUpperCase() }));
  quotes.forEach((q, i) =>
    fake.table('odds_snapshots').push({
      id: i + 1, fixture_id: linkOnly ? null : FIXTURE_ID, source_provider: 'the_odds_api', provider_event_id: 'ev1',
      bookmaker_id: keys.indexOf(q.bookmakerKey) + 1, market_code: q.marketCode, selection_code: q.selectionCode, line: q.line,
      decimal_odds: q.decimalOdds, kind: 'pre_match', source_timestamp: null, captured_at: q.capturedAt,
    }),
  );
  if (linkOnly) fake.table('odds_event_links').push({ source_provider: 'the_odds_api', provider_event_id: 'ev1', fixture_id: FIXTURE_ID });
  return { fake, store: createAnalysisStore(fake) };
}

const sel = (r, m, s, l = null) => r.evaluation.selections.find((x) => x.marketCode === m && x.selectionCode === s && x.line === l);

test('pipeline output equals the domain engine called directly (one engine, CLAUDE.md §4.5)', async () => {
  const { store } = seed();
  const fixture = await store.getFixture(FIXTURE_ID);
  const r = await analyzeFixture({ fixture, mode: 'scanner', now: NOW }, { store });
  const est = estimate({ fixture: FIXTURE, history: L.matches, asOf: NOW.toISOString() });
  assert.equal(r.estimate.status, 'OK');
  assert.deepEqual(r.estimate.lambdas, est.lambdas);
  const quotes = await store.loadQuotes({ fixtureId: FIXTURE_ID, since: new Date(0) });
  const direct = evaluateFixture({ fixture, estimate: est, quotes, fetchedMarkets: ['1X2', 'OU'], mode: 'scanner', now: NOW });
  assert.deepEqual(r.evaluation, direct);
  assert.equal(sel(r, 'OU', 'OVER', 2.5).status, 'QUALIFIED');
  assert.ok(Number.isInteger(sel(r, 'OU', 'OVER', 2.5).bestQuote.snapshotId));
  assert.deepEqual(sel(r, 'BTTS', 'YES').reasonCodes, ['ODDS_NOT_FETCHED']);
  assert.equal(r.match.home, 'Home FC');
  assert.match(r.explanation.text, /Home FC – Team T02/);
});

test('scanner and on-demand modes share the estimate; on-demand treats every market as fetched', async () => {
  const { store } = seed();
  const fixture = await store.getFixture(FIXTURE_ID);
  const a = await analyzeFixture({ fixture, mode: 'scanner', now: NOW, explain: false }, { store });
  const b = await analyzeFixture({ fixture, mode: 'on_demand', now: NOW, explain: false }, { store });
  assert.deepEqual(a.estimate, b.estimate);
  assert.deepEqual(sel(b, 'BTTS', 'YES').reasonCodes, ['ODDS_MISSING']);
  assert.equal(a.explanation, null);
});

test('odds are found through odds_event_links when snapshots carry no fixture_id', async () => {
  const { store } = seed({ linkOnly: true });
  const fixture = await store.getFixture(FIXTURE_ID);
  const r = await analyzeFixture({ fixture, mode: 'scanner', now: NOW, explain: false }, { store });
  assert.equal(r.quoteCount, 27);
  assert.equal(sel(r, 'OU', 'OVER', 2.5).status, 'QUALIFIED');
});

test('history loading never returns matches at or after asOf (leakage guard)', async () => {
  const { store } = seed();
  const cut = new Date(Date.parse(L.matches[100].kickoffUtc));
  const h = await store.loadHistory({ competitionCode: 'EPL', before: cut });
  assert.equal(h.length, 100);
  assert.ok(h.every((m) => Date.parse(m.kickoffUtc) < cut.getTime()));
});

test('predictions: 16 rows per fixture, append-only, re-recorded only when inputs change', async () => {
  const { fake, store } = seed();
  const fixture = await store.getFixture(FIXTURE_ID);
  const cfg = defaultConfig();
  const mv = await store.ensureModelVersion({ modelFamily: MODEL_FAMILY, modelVersion: MODEL_VERSION, config: cfg, configHash: configHash(cfg) });
  assert.equal(await store.ensureModelVersion({ modelFamily: MODEL_FAMILY, modelVersion: MODEL_VERSION, config: cfg, configHash: configHash(cfg) }), mv);
  const runId = await store.startRun({ trigger: 'scanner', scanDate: '2026-10-16', asOf: NOW, modelVersionId: mv, riskVersion: RISK_VERSION, riskConfigHash: riskConfigHash(defaultRiskConfig()) });

  const r1 = await analyzeFixture({ fixture, mode: 'scanner', now: NOW }, { store });
  assert.deepEqual(await recordAnalysis(store, { runId, modelVersionId: mv, result: r1 }), { recorded: true });
  assert.equal(fake.table('predictions').length, 16);
  assert.equal(fake.table('explanations').length, 1);

  // Same inputs again (duplicated run) → nothing new.
  const r2 = await analyzeFixture({ fixture, mode: 'scanner', now: NOW }, { store });
  assert.deepEqual(await recordAnalysis(store, { runId, modelVersionId: mv, result: r2 }), { recorded: false });
  assert.equal(fake.table('predictions').length, 16);

  // New odds batch → a new set of rows; the earlier rows are untouched.
  const before = JSON.stringify(fake.table('predictions'));
  const later = new Date(NOW.getTime() + 3600000);
  const newer = book('b1', { margin: 0.1, boost: BOOST }).map((q) => ({ ...q, decimalOdds: q.decimalOdds + 0.01, capturedAt: later.toISOString() }));
  newer.forEach((q, i) =>
    fake.table('odds_snapshots').push({
      id: 1000 + i, fixture_id: FIXTURE_ID, source_provider: 'the_odds_api', provider_event_id: 'ev1', bookmaker_id: 1,
      market_code: q.marketCode, selection_code: q.selectionCode, line: q.line, decimal_odds: q.decimalOdds, kind: 'pre_match', source_timestamp: null, captured_at: q.capturedAt,
    }),
  );
  const r3 = await analyzeFixture({ fixture, mode: 'scanner', now: later }, { store });
  assert.deepEqual(await recordAnalysis(store, { runId: 'run-2', modelVersionId: mv, result: r3 }), { recorded: true });
  assert.equal(fake.table('predictions').length, 32);
  assert.equal(JSON.stringify(fake.table('predictions').slice(0, 16)), before);

  // The fake rejects updates on append-only tables like the database triggers.
  const res = await fake.from('predictions').update({ ev: 1 }).eq('id', 1);
  assert.equal(res.error.code, '42501');

  await store.finishRun(runId, { status: 'OK', finishedAt: later, counts: { considered: 1, analyzed: 1, recorded: 1 } });
  assert.equal(fake.table('analysis_runs')[0].status, 'OK');
});

test('prediction rows carry versions, exact quote, DNB push/loss and null prices for INSUFFICIENT_DATA', async () => {
  const { store } = seed();
  const fixture = await store.getFixture(FIXTURE_ID);
  const r = await analyzeFixture({ fixture, mode: 'on_demand', now: NOW, explain: false }, { store });
  const rows = predictionRows({ runId: 'run', modelVersionId: 7, result: r });
  assert.equal(rows.length, 16);
  for (const row of rows) {
    assert.equal(row.model_version_id, 7);
    assert.equal(row.risk_version, RISK_VERSION);
    assert.equal(row.input_hash, r.inputHash);
    assert.equal(row.lambda_home, r.estimate.lambdas.home);
    if (row.status === 'INSUFFICIENT_DATA') assert.equal(row.decimal_odds, null);
    else assert.ok(row.odds_snapshot_id && row.decimal_odds && Number.isFinite(row.ev));
  }
  const dnb = rows.find((x) => x.market_code === 'DNB' && x.selection_code === 'HOME');
  const m = r.estimate.markets.DNB.HOME;
  assert.deepEqual([dnb.p_model, dnb.p_push, dnb.p_loss], [m.win, m.push, m.loss]);
  const ou = rows.find((x) => x.market_code === 'OU' && x.line === 2.5 && x.selection_code === 'OVER');
  assert.equal(ou.status, 'QUALIFIED');
  assert.equal(ou.fair_odds, r.estimate.markets.OU[2.5].OVER.fairOdds);
});

test('insufficient history: every selection INSUFFICIENT_DATA, rows still recorded with reasons', async () => {
  const { store } = seed();
  const fixture = await store.getFixture(FIXTURE_ID);
  const r = await analyzeFixture({ fixture, mode: 'scanner', now: NOW, history: L.matches.slice(-50) }, { store });
  assert.equal(r.estimate.status, 'INSUFFICIENT_DATA');
  const rows = predictionRows({ runId: 'run', modelVersionId: 1, result: r });
  assert.ok(rows.every((x) => x.status === 'INSUFFICIENT_DATA' && x.reason_codes.includes('LEAGUE_BASELINE_SAMPLE') && x.p_model === null));
});

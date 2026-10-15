'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scan, scanWatchdog } = require('../../src/jobs/scan');
const { bucharestDate } = require('../../src/time/format');
const { seed } = require('../pipeline/seed');
const { NOW, quote } = require('../risk/helpers');
const { BOOKS } = require('../pipeline/seed');

function fakeSender({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async send(chatId, text) {
      if (fail) throw new Error('network down');
      sent.push({ chatId, text });
    },
  };
}

const usage = async () => ({ used: 20, monthlyLimit: 500, providerRemaining: 437 });

test('scanner analyses upcoming fixtures, records predictions and sends one digest per day', async () => {
  const { fake, store } = seed();
  const sender = fakeSender();
  const r = await scan({ store, sender, chatIds: [111, 222], usage, now: () => NOW });
  assert.equal(r.scanDate, bucharestDate(NOW));
  assert.deepEqual([r.status, r.considered, r.analyzed, r.recorded, r.failed, r.digest, r.sent], ['OK', 1, 1, 1, 0, 'CREATED', 2]);
  assert.equal(fake.table('predictions').length, 16);
  assert.ok(fake.table('predictions').every((p) => p.mode === 'scanner' && p.analysis_run_id === r.runId));
  assert.equal(fake.table('scan_digests').length, 1);
  const run = fake.table('analysis_runs')[0];
  assert.deepEqual([run.trigger, run.scan_date, run.status, run.fixtures_recorded], ['scanner', r.scanDate, 'OK', 1]);

  const text = sender.sent[0].text;
  assert.equal(sender.sent[1].text, text);
  // Short summary first (line shopping, D-24), then the details. The seed has no Pinnacle odds: no picks.
  assert.match(text, /^FVIS — scanare zilnică .*\n\nSELECȚIILE ZILEI \(LINE_VALUE · Unibet\)\nNiciuna azi la Unibet\.\nToate casele din sursă: 0 candidate .*\n.*FVIS nu dă sfaturi de pariere\.\nRezultatele testului: \/clv\n\nDETALII\n/);
  assert.match(text, /QUALIFIED este suspendat, backtestul nu arată valoare reală \(D-23\)/);
  // Line candidates are recorded for the analysed fixture (3 selections × 2 scopes), without a reference.
  assert.equal(fake.table('line_candidates').length, 6);
  assert.ok(fake.table('line_candidates').every((c) => c.status === 'INSUFFICIENT_DATA' && c.reason_codes.includes('NO_SHARP_REFERENCE')));
  assert.deepEqual(r.line, { evaluated: 1, inserted: 6, failed: 0 });
  assert.doesNotMatch(text, /ELIGIBILE PENTRU URMĂRIRE/);
  assert.match(text, /DE URMĂRIT \(WATCHLIST\)/);
  assert.match(text, /condiții neîndeplinite: QUALIFIED suspendat/);
  assert.ok(text.indexOf('DETALII') < text.indexOf('DE URMĂRIT'));
  assert.match(text, /Home FC – Team T02/);
  assert.match(text, /Peste 2\.5 goluri: cotă \d+\.\d\d \(B\d\) · model \d+\.\d% · piață \d+\.\d% · EV \+\d+\.\d%/);
  assert.match(text, /Credite cote luna aceasta: 20 din 500 \(rămase la furnizor: 437\)/);
  assert.match(text, /nu sigur, nu garantat, nu profitabil/);
  assert.doesNotMatch(text, /Ambele marchează/); // not fetched by the scanner (D-11), never highlighted
});

test('a duplicated run on the same day sends no second digest and records nothing new', async () => {
  const { fake, store } = seed();
  const first = fakeSender();
  await scan({ store, sender: first, chatIds: [111], usage, now: () => NOW });
  const second = fakeSender();
  const r = await scan({ store, sender: second, chatIds: [111], usage, now: () => new Date(NOW.getTime() + 600000) });
  assert.equal(r.digest, 'ALREADY_EXISTS');
  assert.equal(r.recorded, 0);
  assert.equal(second.sent.length, 0);
  assert.equal(fake.table('scan_digests').length, 1);
  assert.equal(fake.table('predictions').length, 16);
  assert.equal(fake.table('line_candidates').length, 6); // same odds → no new line rows
  assert.equal(fake.table('analysis_runs').length, 2);
});

test('a lost race on the digest claim does not send (primary key on scan_date)', async () => {
  const { store } = seed();
  const racing = { ...store, getDigest: async () => null };
  await store.insertDigest({ scanDate: bucharestDate(NOW), runId: 'other-run', text: 'x' });
  const sender = fakeSender();
  const r = await scan({ store: racing, sender, chatIds: [111], now: () => NOW });
  assert.equal(r.digest, 'ALREADY_EXISTS');
  assert.equal(sender.sent.length, 0);
});

test('Telegram failure: run is PARTIAL, digest stays stored for /scan', async () => {
  const { fake, store } = seed();
  const r = await scan({ store, sender: fakeSender({ fail: true }), chatIds: [111], now: () => NOW });
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.sendErrors, 1);
  assert.equal(fake.table('scan_digests').length, 1);
  assert.match(fake.table('analysis_runs')[0].error_summary, /Telegram/);
});

test('no fixtures in the horizon still produces a short digest (proof the scanner ran)', async () => {
  const { store } = seed();
  const sender = fakeSender();
  const r = await scan({ store, sender, chatIds: [111], now: () => NOW, horizonHours: 1 });
  assert.equal(r.considered, 0);
  assert.match(sender.sent[0].text, /Meciuri analizate: 0/);
  assert.match(sender.sent[0].text, /nu identifică azi selecții/);
});

test('a failing fixture is counted, the run is PARTIAL and the others continue', async () => {
  const { store } = seed();
  const broken = { ...store, loadQuotes: async () => { throw new Error('boom'); } };
  const r = await scan({ store: broken, sender: fakeSender(), chatIds: [111], now: () => NOW });
  assert.deepEqual([r.status, r.failed, r.digest], ['PARTIAL', 1, 'CREATED']);
});

test('watchdog alerts when no successful scanner run exists today, stays quiet otherwise', async () => {
  const { store } = seed();
  const s1 = fakeSender();
  const missed = await scanWatchdog({ store, sender: s1, chatIds: [111], now: () => NOW });
  assert.equal(missed.ok, false);
  assert.match(s1.sent[0].text, /scanerul zilnic nu a rulat cu succes azi/);

  await scan({ store, sender: fakeSender(), chatIds: [111], now: () => NOW });
  const s2 = fakeSender();
  const ok = await scanWatchdog({ store, sender: s2, chatIds: [111], now: () => new Date(NOW.getTime() + 3 * 3600000) });
  assert.equal(ok.ok, true);
  assert.equal(s2.sent.length, 0);
});

test('UCL/UEL days: the digest has a market-only cup section; nothing is recorded for cups (D-19)', async () => {
  const { fake, store } = seed();
  fake.table('odds_events').push({ source_provider: 'the_odds_api', provider_event_id: 'ucl-1', competition_code: 'UCL', kickoff_utc: new Date(NOW.getTime() + 3600000 * 10).toISOString(), home_team_name: 'Benfica', away_team_name: 'Celtic' });
  fake.table('bookmakers').push({ id: 99, source_provider: 'the_odds_api', provider_bookmaker_key: 'cup', name: 'Cup' });
  [['HOME', 1.25], ['DRAW', 6.5], ['AWAY', 11]].forEach(([sel, o], i) =>
    fake.table('odds_snapshots').push({ id: 9000 + i, fixture_id: null, source_provider: 'the_odds_api', provider_event_id: 'ucl-1', bookmaker_id: 99, market_code: '1X2', selection_code: sel, line: null, decimal_odds: o, kind: 'pre_match', source_timestamp: null, captured_at: NOW.toISOString() }),
  );
  const sender = fakeSender();
  const r = await scan({ store, sender, chatIds: [1], now: () => NOW });
  assert.equal(r.cups, 1);
  const text = sender.sent[0].text;
  assert.match(text, /SELECȚIILE ZILEI \(LINE_VALUE · Unibet\)\nNiciuna azi la Unibet\./);
  assert.match(text, /CUPE EUROPENE — DOAR PIAȚA \(informativ\)/);
  assert.match(text, /UEFA Champions League · .* — Benfica – Celtic\n {2}piață: 1 \d+\.\d% · X \d+\.\d% · 2 \d+\.\d% \(1 case, cote de la \d\d:\d\d, cu 10 h înainte de start: se pot fi mișcat\)/);
  assert.equal(fake.table('predictions').filter((p) => p.fixture_id === 'ucl-1').length, 0);
});

test('D-24: a Unibet price above Pinnacle-fair odds is a LINE_VALUE pick in the digest and is recorded for both scopes', async () => {
  const x = (k, h, d, a) => [quote(k, '1X2', 'HOME', null, h), quote(k, '1X2', 'DRAW', null, d), quote(k, '1X2', 'AWAY', null, a)];
  const quotes = [
    ...BOOKS(),
    ...x('pinnacle', 2.0, 3.6, 4.0),
    ...['b4', 'b5', 'b6', 'b7'].flatMap((k) => x(k, 1.95, 3.4, 3.8)),
    ...x('unibet_se', 2.3, 3.4, 3.8),
  ];
  const { fake, store } = seed({ quotes });
  const sender = fakeSender();
  const r = await scan({ store, sender, chatIds: [111], usage, now: () => NOW });
  assert.equal(r.status, 'OK');
  const text = sender.sent[0].text;
  assert.match(text, /SELECȚIILE ZILEI \(LINE_VALUE · Unibet\)\n• Home FC – Team T02 · Victorie gazde \(1\) · Unibet \(SE\) 2\.30 · avantaj \+\d+\.\d% · /);
  assert.match(text, /Toate casele din sursă: 1 candidate/);
  assert.match(text, /aproximează unibet\.ro/);
  const rows = fake.table('line_candidates').filter((c) => c.status === 'LINE_VALUE');
  assert.deepEqual(rows.map((c) => [c.scope, c.selection_code, c.bookmaker_key, c.price]).sort(), [['all', 'HOME', 'unibet_se', 2.3], ['playable', 'HOME', 'unibet_se', 2.3]]);
  assert.ok(rows.every((c) => c.analysis_run_id === r.runId && c.rule_version === '1.1.0' && c.pin_snapshot_id && c.price_snapshot_id));
});

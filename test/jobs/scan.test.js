'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scan, scanWatchdog } = require('../../src/jobs/scan');
const { bucharestDate } = require('../../src/time/format');
const { seed } = require('../pipeline/seed');
const { NOW } = require('../risk/helpers');

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
  assert.match(text, /ELIGIBILE PENTRU URMĂRIRE \(QUALIFIED\)/);
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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot } = require('../src/telegram/bot');
const { lineSectionLines, clvMessage, bookmakerLabel } = require('../src/telegram/lineView');
const { evaluateLineShopping } = require('../src/domain/lineShopping');
const { lineReport } = require('../src/domain/lineShopping/report');
const { createAnalysisStore } = require('../src/persistence/analysisStore');
const { createFakeDb } = require('./persistence/fakeDb');
const { VALID_ENV, createMemoryLogger, stubTelegram, messageUpdate } = require('./helpers');

const NOW = new Date('2026-10-17T08:30:00Z');
const USER = 111111111;

test('bookmaker labels', () => {
  assert.equal(bookmakerLabel('unibet_se'), 'Unibet (SE)');
  assert.equal(bookmakerLabel('onexbet'), 'Onexbet');
  assert.equal(bookmakerLabel(null), 'n/a');
});

test('/analyze line section shows Pinnacle fair probability, best price overall and at Unibet', () => {
  const q = (k, s, o) => ({ bookmakerKey: k, marketCode: '1X2', selectionCode: s, line: null, decimalOdds: o, kind: 'pre_match', capturedAt: '2026-10-17T08:20:00Z' });
  const set = (k, h, d, a) => [q(k, 'HOME', h), q(k, 'DRAW', d), q(k, 'AWAY', a)];
  const quotes = [...set('pinnacle', 2.0, 3.6, 4.0), ...['b1', 'b2', 'b3', 'b4'].flatMap((k) => set(k, 1.95, 3.4, 3.8)), ...set('onexbet', 2.2, 3.4, 3.8), ...set('unibet_nl', 2.06, 3.3, 3.7)];
  const text = lineSectionLines(evaluateLineShopping({ quotes, kickoffUtc: '2026-10-18T13:30:00Z', now: NOW })).join('\n');
  assert.match(text, /• Victorie gazde \(1\): Pinnacle 2\.00 → 49\.1%\n {2}cel mai bun preț: Onexbet 2\.20, avantaj \+8\.0%, LINE_VALUE\n {2}Unibet: Unibet \(NL\) 2\.06, avantaj \+1\.1%, WATCHLIST\n {2}Unibet, condiții neîndeplinite: avantaj sub pragul minim/);
  assert.match(text, /• Egal \(X\): Pinnacle 3\.60 → 26\.8%\n {2}cel mai bun preț: B1 3\.40, avantaj −8\.8%, NO_VALUE/);
  assert.match(text, /FVIS nu dă sfaturi de pariere/);
});

function seedDb() {
  const db = createFakeDb();
  const row = (id, scope, fixtureId, createdAt) => ({ id, rule_version: '1.1.0', scope, fixture_id: fixtureId, selection_code: 'HOME', bookmaker_key: 'unibet_se', price: 2.2, edge: 0.05, status: 'LINE_VALUE', kickoff_utc: '2026-10-18T13:30:00Z', created_at: createdAt });
  db.table('line_candidates').push(
    row(1, 'all', 'f1', '2026-10-15T08:20:00Z'), row(2, 'playable', 'f1', '2026-10-15T08:20:00Z'),
    row(3, 'all', 'f2', '2026-10-16T08:20:00Z'), row(4, 'all', 'f1', '2026-10-16T08:20:00Z'),
    { ...row(5, 'all', 'f3', '2026-10-16T08:20:00Z'), status: 'WATCHLIST' },
    { ...row(6, 'all', 'f4', '2026-10-14T08:20:00Z'), rule_version: '1.0.0' }, // earlier rule: counted apart
  );
  db.table('line_candidate_outcomes').push(
    { candidate_id: 1, result: 'WIN', clv: 0.04, close_ev: 0.03, profit_per_unit: 1.2 },
    { candidate_id: 2, result: 'WIN', clv: 0.04, close_ev: 0.03, profit_per_unit: 1.2 },
    { candidate_id: 3, result: 'LOSS', clv: 0.02, close_ev: 0.01, profit_per_unit: -1 },
  );
  return db;
}

test('/clv reports both scopes from stored rows (first LINE_VALUE row per selection) and uses no credits', async (t) => {
  const db = seedDb();
  const store = createAnalysisStore(db);
  const data = { clv: async () => clvMessage(lineReport(await store.lineValueCandidates(), { now: NOW })) };
  const { logger } = createMemoryLogger();
  const bot = createBot({ token: VALID_ENV.TELEGRAM_BOT_TOKEN, allowedUserIds: new Set([USER]), logger, getStatus: () => ({ version: '0.1.0', uptimeSeconds: 5, now: NOW }), data, now: () => NOW });
  const calls = stubTelegram(bot, t);
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/clv' }));
  const text = calls.map((c) => c.payload.text).join('\n');
  assert.match(text, /^Test pe hârtie line shopping \(Faza 6d, regula 1\.1\.0\), început 2026-10-15, 0\.3 săptămâni/);
  assert.match(text, /UNIBET \(casele tale\)\nCandidate: 1 · decontate: 1 \(1 câștigate\) · în așteptare: 0\nCu cotă de închidere Pinnacle: 1 candidate din 1 meciuri distincte \(prag: 150 candidate din cel puțin 75 meciuri\)\nCLV mediu: \+4\.0%\nEV la închidere: \+3\.0%\n/);
  assert.match(text, /După timpul până la start \(captură → start\):\n {2}< 12h: 0 candidate · CLV mediu n\/a · EV la închidere n\/a\n {2}12–48h: 0 candidate[^\n]*\n {2}altele \(> 48h\): 1 candidate · CLV mediu \+4\.0% · EV la închidere \+3\.0%\nROI pe hârtie: \+120\.0%/);
  assert.match(text, /TOATE CASELE DIN SURSĂ\nCandidate: 2 · decontate: 2 \(1 câștigate\)[\s\S]*2 candidate din 2 meciuri distincte[\s\S]*EV la închidere: \+2\.0% \(IÎ 95%: \+0\.0% … \+4\.0%\)\n[\s\S]*ROI pe hârtie: \+10\.0%[\s\S]*Verdict: în curs/);
  assert.match(text, /IÎ este grupat pe meci/);
  assert.match(text, /versiuni anterioare ale regulii \(1\) rămân în baza de date, dar nu intră în calcul/);
  assert.equal(db.table('analysis_runs').length, 0);
});

test('/clv before any candidate says so; without a database it reports data unavailable', async (t) => {
  assert.match(clvMessage(lineReport([], { now: NOW })), /nu are încă nicio candidată/);
  const { logger } = createMemoryLogger();
  const bot = createBot({ token: VALID_ENV.TELEGRAM_BOT_TOKEN, allowedUserIds: new Set([USER]), logger, getStatus: () => ({ version: '0.1.0', uptimeSeconds: 5, now: NOW }), data: null, now: () => NOW });
  const calls = stubTelegram(bot, t);
  await bot.handleUpdate(messageUpdate({ userId: USER, text: '/clv' }));
  assert.match(calls[0].payload.text, /Datele nu sunt disponibile/);
});

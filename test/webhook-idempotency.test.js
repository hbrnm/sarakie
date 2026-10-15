'use strict';

// Render cold start + slow /analyze: a Telegram re-delivery of the same update_id must not
// fetch odds (spend Odds API credits) a second time. Full path: HTTP webhook → Telegraf bot
// → on-demand analyzer → Odds API adapter double.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpServer } = require('../src/http/server');
const { createBot } = require('../src/telegram/bot');
const { createOnDemandAnalyzer } = require('../src/pipeline/onDemand');
const { createRepositories } = require('../src/persistence/repositories');
const { seed } = require('./pipeline/seed');
const { fakeOdds } = require('./pipeline/fakeOdds');
const { NOW } = require('./risk/helpers');
const { VALID_ENV, createMemoryLogger, stubTelegram, messageUpdate } = require('./helpers');

const SECRET = VALID_ENV.TELEGRAM_WEBHOOK_SECRET;
const USER = 111111111;

async function setup(t, gate) {
  const { fake, store } = seed({ quotes: [] });
  const odds = fakeOdds({ gate });
  const credits = () => odds.calls.eventOdds.length * 6; // every event-odds call costs credits
  const analyzer = createOnDemandAnalyzer({ store, repo: createRepositories(fake), odds, budget: { usage: async () => ({ on_demand: credits(), onDemandMonthlyCap: 200 }) }, now: () => NOW });
  const { logger, lines } = createMemoryLogger();
  const bot = createBot({
    token: VALID_ENV.TELEGRAM_BOT_TOKEN,
    allowedUserIds: new Set([USER]),
    logger,
    getStatus: () => ({ version: '0.1.0', uptimeSeconds: 1, now: NOW }),
    data: { analyze: (text) => analyzer.analyze(text) },
    now: () => NOW,
  });
  const replies = stubTelegram(bot, t);
  const server = createHttpServer({ webhookPath: '/telegram/webhook', webhookSecret: SECRET, handleUpdate: (u) => bot.handleUpdate(u), getStatus: () => ({ version: '0.1.0', uptimeSeconds: 1, now: NOW }), logger });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const deliver = (update) =>
    fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify(update),
    });
  return { odds, fake, replies, lines, server, deliver };
}

test('a re-delivered /analyze update (same update_id) does not spend Odds API credits twice', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { odds, fake, replies, lines, server, deliver } = await setup(t, gate);
  const update = messageUpdate({ userId: USER, text: '/analyze Home FC - Team T02' });

  // First delivery is acknowledged at once although the odds fetch is still pending.
  const first = await deliver(update);
  assert.deepEqual([first.status, await first.json()], [200, { ok: true }]);
  // Telegram retries while the first delivery is still being processed, and once more later.
  const retry = await deliver(update);
  assert.deepEqual([retry.status, (await retry.json()).duplicate], [200, true]);
  release();
  await server.drain();
  const late = await deliver(update);
  assert.equal((await late.json()).duplicate, true);
  await server.drain();

  assert.equal(odds.calls.eventOdds.length, 1, 'one credit-consuming odds call');
  assert.equal(fake.table('analysis_runs').length, 1, 'one on-demand run recorded');
  assert.equal(replies.filter((c) => c.method === 'sendMessage' && /Home FC – Team T02/.test(c.payload.text)).length, 1);
  assert.equal(lines.filter((l) => l.msg === 'http.webhook_duplicate').length, 2);

  // A new message (new update_id) is processed normally.
  await deliver(messageUpdate({ userId: USER, text: '/analyze Home FC - Team T02' }));
  await server.drain();
  assert.equal(fake.table('analysis_runs').length, 2);
});

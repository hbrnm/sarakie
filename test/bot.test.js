'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot } = require('../src/telegram/bot');
const { VALID_ENV, createMemoryLogger, stubTelegram, messageUpdate } = require('./helpers');

const ALLOWED = 111111111;
const STRANGER = 333333333;

function setup(t) {
  const { lines, logger } = createMemoryLogger();
  const bot = createBot({
    token: VALID_ENV.TELEGRAM_BOT_TOKEN,
    allowedUserIds: new Set([ALLOWED]),
    logger,
    getStatus: () => ({ version: '0.1.0', uptimeSeconds: 125, now: new Date('2026-07-01T12:00:00Z') }),
  });
  const calls = stubTelegram(bot, t);
  return { bot, calls, lines };
}

test('non-allowlisted user gets no reply and is logged by numeric id', async (t) => {
  const { bot, calls, lines } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: STRANGER, text: '/start' }));
  assert.equal(calls.length, 0);
  const entry = lines.find((l) => l.msg === 'telegram.unauthorized');
  assert.equal(entry.telegramUserId, STRANGER);
});

test('allowlisted user in a group chat is ignored', async (t) => {
  const { bot, calls } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: ALLOWED, text: '/start', chatType: 'group' }));
  assert.equal(calls.length, 0);
});

test('authorization does not depend on username', async (t) => {
  const { bot, calls } = setup(t);
  const update = messageUpdate({ userId: STRANGER, text: '/start' });
  update.message.from.username = 'the_product_owner';
  await bot.handleUpdate(update);
  assert.equal(calls.length, 0);
});

test('/start replies in Romanian with the disclaimer', async (t) => {
  const { bot, calls } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: ALLOWED, text: '/start' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  assert.match(calls[0].payload.text, /Bun venit în FVIS/);
  assert.match(calls[0].payload.text, /nu sigur, nu garantat/);
});

test('/help lists commands', async (t) => {
  const { bot, calls } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: ALLOWED, text: '/help' }));
  assert.match(calls[0].payload.text, /\/health/);
});

test('/health shows status and Bucharest time, without secrets', async (t) => {
  const { bot, calls } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: ALLOWED, text: '/health' }));
  const text = calls[0].payload.text;
  assert.match(text, /Stare: OK/);
  assert.match(text, /01\.07\.2026, 15:00/); // 12:00 UTC = 15:00 EEST
  assert.ok(!text.includes(VALID_ENV.TELEGRAM_BOT_TOKEN));
  assert.ok(!text.includes(VALID_ENV.TELEGRAM_WEBHOOK_SECRET));
});

test('unknown text gets a help hint', async (t) => {
  const { bot, calls } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: ALLOWED, text: 'salut' }));
  assert.match(calls[0].payload.text, /Comandă necunoscută/);
});

test('/health sent as code-formatted text is still recognized', async (t) => {
  const { bot, calls } = setup(t);
  const update = messageUpdate({ userId: ALLOWED, text: '/health' });
  update.message.entities = [{ type: 'code', offset: 0, length: 7 }];
  await bot.handleUpdate(update);
  assert.match(calls[0].payload.text, /Stare: OK/);
});

test('command addressed to this bot by username, any case, is recognized', async (t) => {
  const { bot, calls } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: ALLOWED, text: '/HEALTH@FVIS_test_bot' }));
  assert.match(calls[0].payload.text, /Stare: OK/);
});

test('parseCommand', () => {
  const { parseCommand } = require('../src/telegram/bot');
  assert.equal(parseCommand('/start', 'fvis_bot'), 'start');
  assert.equal(parseCommand('  /help extra args', 'fvis_bot'), 'help');
  assert.equal(parseCommand('/health@other_bot', 'fvis_bot'), null);
  assert.equal(parseCommand('health', 'fvis_bot'), null);
  assert.equal(parseCommand('/', 'fvis_bot'), null);
  assert.equal(parseCommand('/constructor', 'fvis_bot'), 'constructor');
});

test('prototype names are not treated as commands', async (t) => {
  const { bot, calls } = setup(t);
  await bot.handleUpdate(messageUpdate({ userId: ALLOWED, text: '/constructor' }));
  assert.match(calls[0].payload.text, /Comandă necunoscută/);
});

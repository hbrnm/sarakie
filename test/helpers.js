'use strict';

const VALID_ENV = Object.freeze({
  TELEGRAM_BOT_TOKEN: '123456789:AAFakeTokenForTestsOnly_abcdefghijklmno',
  TELEGRAM_WEBHOOK_SECRET: 'test_webhook_secret_0123456789abcdefXYZ',
  TELEGRAM_ALLOWED_USER_IDS: '111111111, 222222222',
});

function createMemoryLogger() {
  const lines = [];
  const sink = { out: (s) => lines.push(JSON.parse(s)), err: (s) => lines.push(JSON.parse(s)) };
  const { createLogger } = require('../src/logging/logger');
  return { lines, sink, logger: createLogger({ sink }) };
}

/**
 * Captures Telegram Bot API calls instead of sending them. Telegraf creates a new
 * Telegram client per update, so the stub is installed on the prototype; it is
 * restored automatically after the current test.
 */
function stubTelegram(bot, t) {
  const { Telegram } = require('telegraf');
  const calls = [];
  bot.botInfo = { id: 999, is_bot: true, first_name: 'FVIS', username: 'fvis_test_bot' };
  t.mock.method(Telegram.prototype, 'callApi', async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length, date: 0, chat: { id: payload.chat_id, type: 'private' } };
  });
  return calls;
}

let nextUpdateId = 1;
function messageUpdate({ userId, text, chatType = 'private' }) {
  const id = nextUpdateId++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1760500000,
      from: { id: userId, is_bot: false, first_name: 'T' },
      chat: { id: chatType === 'private' ? userId : -100, type: chatType },
      text,
      entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined,
    },
  };
}

module.exports = { VALID_ENV, createMemoryLogger, stubTelegram, messageUpdate };

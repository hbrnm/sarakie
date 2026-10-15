'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramSender, splitMessage } = require('../src/telegram/send');
const { bucharestDate } = require('../src/time/format');

const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';

test('splitMessage keeps lines whole and every chunk under the limit', () => {
  const text = Array.from({ length: 300 }, (_, i) => `linia ${i} ${'x'.repeat(40)}`).join('\n');
  const parts = splitMessage(text, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join('\n'), text);
  assert.deepEqual(splitMessage('a'.repeat(25), 10), ['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
});

test('sender posts plain text, retries 5xx, gives up on 4xx, never leaks the token', async () => {
  const calls = [];
  let status = [500, 200];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: status[0] === 200, status: status.shift() };
  };
  const sender = createTelegramSender({ token: TOKEN, fetchImpl, sleep: async () => {} });
  await sender.send(42, 'salut');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { chat_id: 42, text: 'salut', disable_web_page_preview: true });

  status = [403];
  await assert.rejects(sender.send(42, 'x'), (err) => /HTTP 403/.test(err.message) && !err.message.includes(TOKEN));

  const failing = createTelegramSender({ token: TOKEN, fetchImpl: async () => { throw new Error(`connect to https://api.telegram.org/bot${TOKEN} failed`); }, sleep: async () => {} });
  await assert.rejects(failing.send(1, 'x'), (err) => !err.message.includes(TOKEN) && /REDACTED/.test(err.message));
});

test('scan date is the Europe/Bucharest calendar day', () => {
  assert.equal(bucharestDate(new Date('2026-10-15T21:30:00Z')), '2026-10-16'); // 00:30 EEST
  assert.equal(bucharestDate(new Date('2026-12-31T21:59:00Z')), '2026-12-31'); // 23:59 EET
});

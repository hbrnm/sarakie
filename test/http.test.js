'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpServer, MAX_BODY_BYTES } = require('../src/http/server');
const { VALID_ENV, createMemoryLogger } = require('./helpers');

const SECRET = VALID_ENV.TELEGRAM_WEBHOOK_SECRET;

async function withServer(fn, { handleUpdate } = {}) {
  const handled = [];
  const { logger, lines } = createMemoryLogger();
  const server = createHttpServer({
    webhookPath: '/telegram/webhook',
    webhookSecret: SECRET,
    handleUpdate: handleUpdate || (async (u) => handled.push(u)),
    getStatus: () => ({ version: '0.1.0', uptimeSeconds: 42.7, now: new Date() }),
    logger,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, handled, lines, drain: () => server.drain() });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

test('GET /health returns status without secrets', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok', version: '0.1.0', uptimeSeconds: 42 });
  });
});

test('webhook without secret header is rejected with 401', async () => {
  await withServer(async ({ base, handled }) => {
    const res = await post(base, JSON.stringify({ update_id: 1 }));
    assert.equal(res.status, 401);
    assert.equal(handled.length, 0);
  });
});

test('webhook with wrong secret is rejected with 401', async () => {
  await withServer(async ({ base, handled }) => {
    const res = await post(base, JSON.stringify({ update_id: 1 }), { 'x-telegram-bot-api-secret-token': `${SECRET}x` });
    assert.equal(res.status, 401);
    assert.equal(handled.length, 0);
  });
});

test('webhook with malformed JSON returns 400', async () => {
  await withServer(async ({ base }) => {
    const res = await post(base, '{not json', { 'x-telegram-bot-api-secret-token': SECRET });
    assert.equal(res.status, 400);
  });
});

test('webhook without integer update_id returns 400', async () => {
  await withServer(async ({ base }) => {
    const res = await post(base, JSON.stringify({ update_id: 'x' }), { 'x-telegram-bot-api-secret-token': SECRET });
    assert.equal(res.status, 400);
  });
});

test('oversized webhook body returns 413', async () => {
  await withServer(async ({ base, handled }) => {
    const res = await post(base, 'x'.repeat(MAX_BODY_BYTES + 1), { 'x-telegram-bot-api-secret-token': SECRET });
    assert.equal(res.status, 413);
    assert.equal(handled.length, 0);
  });
});

test('valid update is handled once; redelivery is acknowledged but not reprocessed', async () => {
  await withServer(async ({ base, handled, drain }) => {
    const body = JSON.stringify({ update_id: 77, message: { text: '/start' } });
    const h = { 'x-telegram-bot-api-secret-token': SECRET };
    assert.equal((await post(base, body, h)).status, 200);
    const second = await post(base, body, h);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).duplicate, true);
    await drain();
    assert.equal(handled.length, 1);
  });
});

test('the webhook is acknowledged before a slow update finishes processing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let done = false;
  await withServer(
    async ({ base, drain }) => {
      const res = await post(base, JSON.stringify({ update_id: 78 }), { 'x-telegram-bot-api-secret-token': SECRET });
      assert.equal(res.status, 200);
      assert.equal(done, false); // 200 sent while the handler is still running
      release();
      await drain();
      assert.equal(done, true);
    },
    { handleUpdate: async () => { await gate; done = true; } },
  );
});

test('handler failure is logged and still acknowledged with 200', async () => {
  await withServer(
    async ({ base, lines, drain }) => {
      const res = await post(base, JSON.stringify({ update_id: 5 }), { 'x-telegram-bot-api-secret-token': SECRET });
      assert.equal(res.status, 200);
      await drain();
      assert.ok(lines.some((l) => l.msg === 'http.update_failed'));
    },
    { handleUpdate: async () => { throw new Error('boom'); } },
  );
});

test('wrong method and unknown path', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/telegram/webhook`)).status, 405);
    assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpClient, createIntervalLimiter, ProviderError } = require('../../src/providers/http');
const { createFakeFetch, noSleep } = require('./fakes');

test('retries 5xx with backoff, then succeeds', async () => {
  let n = 0;
  const { fetchImpl } = createFakeFetch({ '/x': () => (++n < 3 ? { status: 503, body: {} } : { body: { ok: 1 } }) });
  const delays = [];
  const c = createHttpClient({ provider: 'p', fetchImpl, sleep: async (ms) => delays.push(ms), random: () => 0 });
  const r = await c.get('https://h.test/x');
  assert.deepEqual(r.body, { ok: 1 });
  assert.deepEqual(delays, [1000, 2000]);
});

test('does not retry 4xx or 429', async () => {
  for (const status of [400, 403, 404, 429]) {
    const { fetchImpl, calls } = createFakeFetch({ '/x': { status, body: {} } });
    const c = createHttpClient({ provider: 'p', fetchImpl, sleep: noSleep });
    await assert.rejects(c.get('https://h.test/x'), (e) => e instanceof ProviderError && e.status === status);
    assert.equal(calls.length, 1);
  }
});

test('gives up after retries on persistent network errors, with secrets redacted', async () => {
  const { fetchImpl, calls } = createFakeFetch({ '/x': () => new Error('connect failed for key=SECRET123') });
  const c = createHttpClient({ provider: 'p', fetchImpl, sleep: noSleep, retries: 2, secrets: ['SECRET123'] });
  await assert.rejects(c.get('https://h.test/x?apiKey=SECRET123'), (e) => {
    assert.equal(e.code, 'NETWORK');
    assert.ok(!e.message.includes('SECRET123'));
    return true;
  });
  assert.equal(calls.length, 3);
});

test('onRequest logs path only, never the query string', async () => {
  const seen = [];
  const { fetchImpl } = createFakeFetch({ '/x': { body: {} } });
  const c = createHttpClient({ provider: 'p', fetchImpl, onRequest: (e) => seen.push(e) });
  await c.get('https://h.test/x?apiKey=SECRET123');
  assert.equal(seen[0].endpoint, '/x');
  assert.ok(!JSON.stringify(seen[0].endpoint).includes('SECRET123'));
});

test('invalid JSON is a provider error', async () => {
  const { fetchImpl } = createFakeFetch({ '/x': { body: '{oops' } });
  const c = createHttpClient({ provider: 'p', fetchImpl });
  await assert.rejects(c.get('https://h.test/x'), (e) => e.code === 'INVALID_JSON');
});

test('interval limiter spaces calls', async () => {
  let t = 0;
  const slept = [];
  const wait = createIntervalLimiter(6500, { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  await wait();
  await wait();
  await wait();
  assert.deepEqual(slept, [6500, 6500]);
});

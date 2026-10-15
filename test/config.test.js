'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, ConfigError } = require('../src/config');
const { VALID_ENV } = require('./helpers');

test('valid environment loads with parsed allowlist and defaults', () => {
  const c = loadConfig({ ...VALID_ENV });
  assert.deepEqual([...c.telegram.allowedUserIds], [111111111, 222222222]);
  assert.equal(c.port, 10000);
  assert.equal(c.publicBaseUrl, null);
  assert.ok(Object.isFrozen(c));
});

test('missing required variables are reported by name only', () => {
  assert.throws(() => loadConfig({}), (err) => {
    assert.ok(err instanceof ConfigError);
    const names = err.problems.map((p) => p.variable).sort();
    assert.deepEqual(names, ['TELEGRAM_ALLOWED_USER_IDS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']);
    return true;
  });
});

test('error messages never contain the provided secret values', () => {
  const env = { ...VALID_ENV, TELEGRAM_WEBHOOK_SECRET: 'short_secret_value' };
  assert.throws(() => loadConfig(env), (err) => {
    assert.ok(!err.message.includes('short_secret_value'));
    assert.ok(!JSON.stringify(err.problems).includes('short_secret_value'));
    return true;
  });
});

for (const bad of ['', '   ', 'alice', '123,abc', '@username', '0', '-5', '1.5', ',,,']) {
  test(`allowlist rejects ${JSON.stringify(bad)}`, () => {
    assert.throws(() => loadConfig({ ...VALID_ENV, TELEGRAM_ALLOWED_USER_IDS: bad }), ConfigError);
  });
}

test('webhook secret must be at least 32 safe characters', () => {
  assert.throws(() => loadConfig({ ...VALID_ENV, TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(31) }), ConfigError);
  assert.throws(() => loadConfig({ ...VALID_ENV, TELEGRAM_WEBHOOK_SECRET: `${'a'.repeat(32)}!` }), ConfigError);
  assert.doesNotThrow(() => loadConfig({ ...VALID_ENV, TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32) }));
});

test('bot token format is validated', () => {
  assert.throws(() => loadConfig({ ...VALID_ENV, TELEGRAM_BOT_TOKEN: 'not-a-token' }), ConfigError);
});

test('public base URL must be https and loses trailing slash', () => {
  assert.throws(() => loadConfig({ ...VALID_ENV, WEBHOOK_BASE_URL: 'http://example.com' }), ConfigError);
  const c = loadConfig({ ...VALID_ENV, RENDER_EXTERNAL_URL: 'https://fvis.onrender.com/' });
  assert.equal(c.publicBaseUrl, 'https://fvis.onrender.com');
  const d = loadConfig({ ...VALID_ENV, RENDER_EXTERNAL_URL: 'https://a.onrender.com', WEBHOOK_BASE_URL: 'https://b.example.com' });
  assert.equal(d.publicBaseUrl, 'https://b.example.com');
});

test('empty optional variables are treated as unset', () => {
  assert.doesNotThrow(() => loadConfig({ ...VALID_ENV, ODDS_API_KEY: '', SUPABASE_URL: '' }));
});

test('secretValues collects secrets for log redaction', () => {
  const c = loadConfig({ ...VALID_ENV, ODDS_API_KEY: 'odds_key_value_123' });
  assert.ok(c.secretValues.includes(VALID_ENV.TELEGRAM_BOT_TOKEN));
  assert.ok(c.secretValues.includes('odds_key_value_123'));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/logging/logger');
const { formatForDisplay } = require('../src/time/format');
const { formatUptime } = require('../src/telegram/messages');

test('logger redacts secret values anywhere in the line', () => {
  const out = [];
  const logger = createLogger({ secrets: ['supersecretvalue123'], sink: { out: (s) => out.push(s), err: (s) => out.push(s) } });
  logger.error('failed', { error: 'GET https://x/?key=supersecretvalue123 failed' });
  assert.ok(!out[0].includes('supersecretvalue123'));
  assert.match(out[0], /\[REDACTED\]/);
});

test('display time uses Europe/Bucharest across DST', () => {
  assert.match(formatForDisplay(new Date('2026-01-15T12:00:00Z')), /15\.01\.2026, 14:00/); // EET, UTC+2
  assert.match(formatForDisplay(new Date('2026-07-15T12:00:00Z')), /15\.07\.2026, 15:00/); // EEST, UTC+3
  // Night of the switch back to winter time (25 Oct 2026, 04:00 local -> 03:00).
  assert.match(formatForDisplay(new Date('2026-10-25T00:30:00Z')), /03:30/);
  assert.match(formatForDisplay(new Date('2026-10-25T01:30:00Z')), /03:30/);
});

test('uptime formatting', () => {
  assert.equal(formatUptime(65), '1m 5s');
  assert.equal(formatUptime(3 * 3600 + 120), '3h 2m');
  assert.equal(formatUptime(2 * 86400 + 3600), '2z 1h 0m');
});

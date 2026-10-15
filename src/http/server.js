'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY_BYTES = 1024 * 1024;
const SEEN_UPDATES_LIMIT = 500;

/** Constant-time comparison that does not leak length. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(Object.assign(new Error('body too large'), { status: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Keeps the most recent update_ids so that Telegram re-deliveries
 * (e.g. after a Render cold start) are processed only once. An id is marked before its
 * processing starts, so a re-delivery that arrives while the first is still running
 * (a slow /analyze) is also dropped. In memory only: a restart forgets it, but by then
 * every earlier update has been acknowledged (see createHttpServer).
 */
function createUpdateDeduplicator(limit = SEEN_UPDATES_LIMIT) {
  const seen = new Set();
  return (updateId) => {
    if (seen.has(updateId)) return false;
    seen.add(updateId);
    if (seen.size > limit) seen.delete(seen.values().next().value);
    return true;
  };
}

/**
 * @param {{
 *   webhookPath: string,
 *   webhookSecret: string,
 *   handleUpdate: (update: object) => Promise<void>,
 *   getStatus: () => { version: string, uptimeSeconds: number, now: Date },
 *   logger: { info: Function, warn: Function, error: Function },
 * }} deps
 */
function createHttpServer({ webhookPath, webhookSecret, handleUpdate, getStatus, logger }) {
  const isNew = createUpdateDeduplicator();
  const inFlight = new Set();

  async function handleWebhook(req, res) {
    const provided = req.headers['x-telegram-bot-api-secret-token'];
    if (typeof provided !== 'string' || !safeEqual(provided, webhookSecret)) {
      logger.warn('http.webhook_rejected', { reason: 'bad_secret' });
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    let update;
    try {
      const body = await readBody(req, MAX_BODY_BYTES);
      update = JSON.parse(body.toString('utf8'));
    } catch (err) {
      const status = err.status || 400;
      logger.warn('http.webhook_rejected', { reason: status === 413 ? 'too_large' : 'bad_json' });
      sendJson(res, status, { error: status === 413 ? 'payload too large' : 'bad request' });
      return;
    }
    if (!update || typeof update !== 'object' || !Number.isInteger(update.update_id)) {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }
    if (!isNew(update.update_id)) {
      logger.info('http.webhook_duplicate', { updateId: update.update_id });
      sendJson(res, 200, { ok: true, duplicate: true });
      return;
    }
    // Acknowledge at once, then process: a slow command (/analyze after a cold start: fresh
    // odds, optional Gemini) must not keep Telegram waiting, or it re-delivers the update.
    // Replies go out through the Bot API, not the webhook response. A failure is logged and
    // not retried (a retry could spend odds credits twice).
    sendJson(res, 200, { ok: true });
    const job = Promise.resolve()
      .then(() => handleUpdate(update))
      .catch((err) => logger.error('http.update_failed', { updateId: update.update_id, error: err && err.message }))
      .finally(() => inFlight.delete(job));
    inFlight.add(job);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
        const s = getStatus();
        return sendJson(res, 200, { status: 'ok', version: s.version, uptimeSeconds: Math.floor(s.uptimeSeconds) });
      }
      if (url.pathname === webhookPath) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return await handleWebhook(req, res);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      logger.error('http.unhandled', { error: err && err.message });
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      return undefined;
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  /** Resolves when every update accepted so far has been processed (shutdown, tests). */
  server.drain = async () => {
    while (inFlight.size) await Promise.all([...inFlight]);
  };
  return server;
}

module.exports = { createHttpServer, safeEqual, createUpdateDeduplicator, MAX_BODY_BYTES };

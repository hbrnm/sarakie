'use strict';

/**
 * Shared HTTP client for provider adapters.
 * - timeout per attempt;
 * - bounded exponential backoff with jitter, only on network errors and 5xx;
 * - no retry on 4xx (including 429 / quota errors);
 * - secrets redacted from every error message and from logged endpoints.
 */

class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ provider: string, code: string, status?: number, cause?: unknown }} details
   */
  constructor(message, { provider, code, status, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = code;
    this.status = status ?? null;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   provider: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   retries?: number,
 *   baseDelayMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   random?: () => number,
 *   secrets?: string[],
 *   onRequest?: (entry: object) => void,
 * }} options
 */
function createHttpClient({
  provider,
  fetchImpl = fetch,
  timeoutMs = 15_000,
  retries = 3,
  baseDelayMs = 1000,
  sleep = defaultSleep,
  random = Math.random,
  secrets = [],
  onRequest = () => {},
}) {
  const active = secrets.filter((s) => typeof s === 'string' && s.length > 0);
  const redact = (text) => active.reduce((acc, s) => acc.split(s).join('[REDACTED]'), String(text));

  /**
   * @param {string | URL} url
   * @param {{ headers?: Record<string, string>, as?: 'json' | 'text' }} [options]
   * @returns {Promise<{ status: number, headers: Headers, body: any }>}
   */
  async function get(url, { headers = {}, as = 'json' } = {}) {
    const u = new URL(url);
    const endpoint = u.pathname;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        const delay = baseDelayMs * 2 ** (attempt - 1) * (1 + 0.25 * random());
        await sleep(delay);
      }
      const started = Date.now();
      let res;
      try {
        res = await fetchImpl(u, { headers, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        lastError = new ProviderError(`${provider}: network error on ${endpoint}: ${redact(err && err.message)}`, {
          provider,
          code: 'NETWORK',
          cause: err,
        });
        onRequest({ provider, endpoint, status: 0, durationMs: Date.now() - started, attempt });
        continue;
      }
      onRequest({ provider, endpoint, status: res.status, durationMs: Date.now() - started, attempt, headers: res.headers });

      if (res.status >= 500) {
        lastError = new ProviderError(`${provider}: HTTP ${res.status} on ${endpoint}`, { provider, code: 'HTTP_5XX', status: res.status });
        continue;
      }
      if (res.status === 429) {
        throw new ProviderError(`${provider}: rate limited on ${endpoint}`, { provider, code: 'RATE_LIMITED', status: 429 });
      }
      if (res.status >= 400) {
        throw new ProviderError(`${provider}: HTTP ${res.status} on ${endpoint}`, { provider, code: 'HTTP_4XX', status: res.status });
      }
      const text = await res.text();
      if (as === 'text') return { status: res.status, headers: res.headers, body: text };
      try {
        return { status: res.status, headers: res.headers, body: JSON.parse(text) };
      } catch (err) {
        throw new ProviderError(`${provider}: invalid JSON on ${endpoint}`, { provider, code: 'INVALID_JSON', status: res.status, cause: err });
      }
    }
    throw lastError;
  }

  return { get, redact };
}

/** Enforces a minimum interval between calls (e.g. football-data.org: 10 req/min). */
function createIntervalLimiter(minIntervalMs, { now = Date.now, sleep = defaultSleep } = {}) {
  let next = 0;
  return async function wait() {
    const t = now();
    const delay = Math.max(0, next - t);
    next = Math.max(t, next) + minIntervalMs;
    if (delay > 0) await sleep(delay);
  };
}

module.exports = { createHttpClient, createIntervalLimiter, ProviderError };

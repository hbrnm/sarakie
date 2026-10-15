'use strict';

/** Fake fetch: routes by pathname; records calls. */
function createFakeFetch(routes) {
  const calls = [];
  async function fetchImpl(url, init) {
    const u = new URL(url);
    calls.push({ url: u, headers: init && init.headers });
    const handler = routes[u.pathname] || routes['*'];
    if (!handler) return new Response('not found', { status: 404 });
    const r = typeof handler === 'function' ? await handler(u) : handler;
    if (r instanceof Error) throw r;
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status || 200, headers: r.headers || {} });
  }
  return { fetchImpl, calls };
}

const noSleep = async () => {};
const noWait = async () => {};

module.exports = { createFakeFetch, noSleep, noWait };

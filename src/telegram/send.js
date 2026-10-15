'use strict';

const MAX_MESSAGE = 3800; // Telegram limit is 4096 characters

/**
 * Splits text into messages below the Telegram limit, on line boundaries where possible.
 * @returns {string[]}
 */
function splitMessage(text, max = MAX_MESSAGE) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const pieces = [];
    for (let i = 0; i < Math.max(line.length, 1); i += max) pieces.push(line.slice(i, i + max));
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > max) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current}\n${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Minimal Bot API sender for jobs that run outside the bot process (GitHub Actions).
 * Plain text only. Retries network errors and 5xx/429 up to `attempts` times; the token
 * never appears in errors.
 *
 * @param {{ token: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, attempts?: number }} options
 */
function createTelegramSender({ token, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 3 }) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const redact = (msg) => String(msg).split(token).join('[REDACTED]');

  async function sendOne(chatId, text) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) return;
        lastError = new Error(`Telegram sendMessage failed with HTTP ${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastError = new Error(`Telegram sendMessage failed: ${redact(err && err.message)}`);
      }
      if (attempt < attempts) await sleep(1000 * 2 ** (attempt - 1));
    }
    throw lastError;
  }

  /** Sends the text (split if needed) to one chat. */
  async function send(chatId, text) {
    for (const part of splitMessage(text)) await sendOne(chatId, part);
  }

  return { send };
}

module.exports = { createTelegramSender, splitMessage, MAX_MESSAGE };

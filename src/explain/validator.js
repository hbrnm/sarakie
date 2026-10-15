'use strict';

/**
 * Strict validation of LLM-written commentary (CLAUDE.md §4.1). The text is rejected when:
 * - it contains a number that does not appear in the facts (invented statistics or odds);
 * - it uses certainty/advice language ("sigur", "garantat", "pariază", …);
 * - it is empty or too long.
 */

const MAX_LENGTH = 900;

const BANNED = [
  'sigur', 'sigură', 'garantat', 'garantată', 'garanție', 'fără risc', 'nu poți pierde', 'nu ai cum să pierzi',
  'pariază', 'pariați', 'pariu sigur', 'jucați', 'recomand', 'recomandăm', 'mizează', 'mizați', 'all-in',
  'safe', 'sure', 'guaranteed', 'risk-free', 'lock', 'bet now',
];

/** Numeric tokens normalized to "12.5" form (decimal comma → dot). */
function numbers(text) {
  return (String(text).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.'));
}

function bannedPhrase(text) {
  const lower = String(text).toLowerCase();
  return BANNED.find((b) => new RegExp(`(^|[^\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(lower)) || null;
}

/**
 * @param {string} text
 * @param {object} facts output of buildFacts()
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateCommentary(text, facts) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'EMPTY' };
  if (text.length > MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  const banned = bannedPhrase(text);
  if (banned) return { ok: false, reason: `BANNED_PHRASE:${banned}` };
  const allowed = new Set(numbers(JSON.stringify(facts)));
  const invented = numbers(text).find((n) => !allowed.has(n));
  if (invented) return { ok: false, reason: `UNSUPPORTED_NUMBER:${invented}` };
  return { ok: true };
}

module.exports = { validateCommentary, bannedPhrase, MAX_LENGTH };

'use strict';

const { buildFacts } = require('./facts');
const { validateCommentary } = require('./validator');
const { templateCommentary, renderAnalysis } = require('./template');

/**
 * Builds the analysis message. Numbers always come from the deterministic template;
 * Gemini (optional) only writes the commentary, which must pass strict validation,
 * otherwise the template commentary is used (ADR-015).
 *
 * @returns {Promise<{ text: string, generator: 'gemini' | 'template', validated: boolean, rejectionReason: string | null, facts: object }>}
 */
async function explainAnalysis({ match, evaluation, estimate, gemini = null, logger = null }) {
  const facts = buildFacts({ match, evaluation, estimate });
  let generator = 'template';
  let rejectionReason = null;
  let commentary = templateCommentary(facts);
  if (gemini && facts.expectedGoals) {
    try {
      const text = await gemini.commentary(facts);
      const v = validateCommentary(text, facts);
      if (v.ok) {
        commentary = text;
        generator = 'gemini';
      } else {
        rejectionReason = v.reason;
      }
    } catch (err) {
      rejectionReason = err && err.code === 'TIMEOUT' ? 'TIMEOUT' : 'GEMINI_ERROR';
      if (logger) logger.warn('explain.gemini_failed', { error: err && err.message });
    }
    if (rejectionReason && logger) logger.warn('explain.fallback_to_template', { reason: rejectionReason });
  }
  return { text: renderAnalysis(facts, commentary), generator, validated: generator === 'gemini', rejectionReason, facts };
}

module.exports = { explainAnalysis };

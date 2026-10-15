'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { explainAnalysis } = require('../../src/explain');
const { validateCommentary, bannedPhrase } = require('../../src/explain/validator');
const { buildFacts } = require('../../src/explain/facts');
const { createGeminiExplainer } = require('../../src/explain/gemini');
const { evaluateFixture } = require('../../src/domain/risk/evaluate');
const { NOW, FIXTURE, EST, book } = require('../risk/helpers');

const boost = { market: 'OU', sel: 'OVER', line: 2.5, factor: 1.18 };
const evaluation = evaluateFixture({
  fixture: FIXTURE, estimate: EST, quotes: ['a', 'b', 'c'].flatMap((b) => book(b, { margin: 0.1, boost })),
  fetchedMarkets: ['1X2', 'OU'], mode: 'scanner', now: NOW,
});
const match = { home: 'Arsenal', away: 'Chelsea', competition: 'Premier League', kickoff: 'sâm. 18.10, 17:00' };
const facts = buildFacts({ match, evaluation, estimate: EST });
const fakeGemini = (text) => ({ commentary: async () => text });

test('facts contain only QUALIFIED/WATCHLIST highlights with pre-formatted numbers', () => {
  assert.ok(facts.highlights.length >= 1);
  assert.ok(facts.highlights.every((h) => h.status === 'QUALIFIED' || h.status === 'WATCHLIST'));
  assert.match(facts.highlights[0].modelProbability, /^\d+\.\d%$/);
  assert.ok(Object.isFrozen(facts));
});

test('template message: numbers, statuses, limitations and disclaimer; no certainty language', async () => {
  const r = await explainAnalysis({ match, evaluation, estimate: EST });
  assert.equal(r.generator, 'template');
  assert.match(r.text, /Peste 2.5 goluri — ELIGIBIL pentru urmărire \(QUALIFIED\)/);
  assert.match(r.text, /Limitări:/);
  assert.match(r.text, /nu sigur, nu garantat, nu profitabil/);
  assert.equal(bannedPhrase(r.text.replace(/nu sigur, nu garantat/, '')), null);
});

test('valid Gemini commentary is used', async () => {
  const h = facts.highlights[0];
  const text = `Pentru ${h.selection}, modelul estimează ${h.modelProbability}, peste piața de ${h.marketProbability}. Modelul nu știe de accidentări sau rotații.`;
  const r = await explainAnalysis({ match, evaluation, estimate: EST, gemini: fakeGemini(text) });
  assert.equal(r.generator, 'gemini');
  assert.ok(r.text.includes(text));
});

test('invented numbers are rejected → template fallback', async () => {
  const r = await explainAnalysis({ match, evaluation, estimate: EST, gemini: fakeGemini('Gazdele au câștigat 7 din ultimele 9 meciuri.') });
  assert.equal(r.generator, 'template');
  assert.match(r.rejectionReason, /^UNSUPPORTED_NUMBER:/);
});

test('certainty / advice language is rejected', () => {
  for (const t of ['Este un pariu sigur.', 'Câștig garantat aici.', 'Recomand această selecție.', 'This is a safe bet.', 'Pariază pe gazde.', 'Fără risc.']) {
    assert.equal(validateCommentary(t, facts).ok, false, t);
  }
  assert.equal(validateCommentary('Arsenal joacă acasă; miza meciului e mare.', facts).ok, true);
  assert.equal(validateCommentary('Asigură-te că verifici lotul.', facts).ok, true); // "asigur" ≠ "sigur"
});

test('empty, too long, errors and timeouts fall back to the template', async () => {
  for (const g of [fakeGemini(''), fakeGemini('a'.repeat(901)), { commentary: async () => { throw new Error('quota'); } }]) {
    const r = await explainAnalysis({ match, evaluation, estimate: EST, gemini: g });
    assert.equal(r.generator, 'template');
    assert.ok(r.rejectionReason);
  }
  const slow = createGeminiExplainer({ modelId: 'm', timeoutMs: 20, client: { models: { generateContent: () => new Promise(() => {}) } } });
  const r = await explainAnalysis({ match, evaluation, estimate: EST, gemini: slow });
  assert.equal(r.rejectionReason, 'TIMEOUT');
});

test('Gemini client receives only the facts JSON and the strict system instruction', async () => {
  const calls = [];
  const client = { models: { generateContent: async (req) => { calls.push(req); return { text: ' Modelul nu știe de accidentări. ' }; } } };
  const g = createGeminiExplainer({ modelId: 'test-model', client });
  assert.equal(await g.commentary(facts), 'Modelul nu știe de accidentări.');
  assert.equal(calls[0].model, 'test-model');
  assert.deepEqual(JSON.parse(calls[0].contents), JSON.parse(JSON.stringify(facts)));
  assert.match(calls[0].config.systemInstruction, /Nu recomanda pariuri/);
  assert.throws(() => createGeminiExplainer({ modelId: '' }));
});

test('without model output, no Gemini call is made and the reason is explained', async () => {
  let called = false;
  const ev = evaluateFixture({ fixture: FIXTURE, estimate: { ...EST, status: 'INSUFFICIENT_DATA', reasons: ['TEAM_SAMPLE'] }, quotes: [], fetchedMarkets: [], mode: 'scanner', now: NOW });
  const r = await explainAnalysis({ match, evaluation: ev, estimate: { ...EST, status: 'INSUFFICIENT_DATA' }, gemini: { commentary: async () => { called = true; return 'x'; } } });
  assert.equal(called, false);
  assert.match(r.text, /prea puține meciuri pentru o echipă/);
});

'use strict';

const SYSTEM_INSTRUCTION = [
  'Ești asistentul de explicații al FVIS, un instrument privat de cercetare pentru piețe de pariuri la fotbal.',
  'Scrii în română un comentariu scurt (maximum 4 propoziții) despre rezultatele modelului primite ca JSON.',
  'Reguli stricte:',
  '- Folosește DOAR cifrele din JSON, exact cum sunt scrise. Nu calcula, nu rotunji, nu inventa statistici, cote sau probabilități.',
  '- Nu recomanda pariuri, mize sau acțiuni. Nu folosi cuvinte ca „sigur”, „garantat”, „fără risc”, „pariază”, „recomand”.',
  '- QUALIFIED înseamnă doar „eligibil pentru urmărire și validare pe hârtie”.',
  '- Menționează cel puțin o limitare din câmpul "limitations".',
  '- Nu repeta tabelul; explică pe scurt ce înseamnă rezultatele.',
].join('\n');

/**
 * Gemini commentary (explanations only). The client is injectable for tests; in production
 * it is `new GoogleGenAI({ apiKey })` from @google/genai.
 * @param {{ apiKey?: string, modelId: string, client?: object, timeoutMs?: number }} options
 */
function createGeminiExplainer({ apiKey, modelId, client, timeoutMs = 8000 }) {
  if (!modelId) throw new Error('GEMINI_MODEL_ID is required');
  let ai = client;
  if (!ai) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    const { GoogleGenAI } = require('@google/genai');
    ai = new GoogleGenAI({ apiKey });
  }
  return {
    async commentary(facts) {
      const call = ai.models.generateContent({
        model: modelId,
        contents: JSON.stringify(facts),
        config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.2, maxOutputTokens: 300 },
      });
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Gemini timeout'), { code: 'TIMEOUT' })), timeoutMs);
      });
      try {
        const res = await Promise.race([call, timeout]);
        return typeof res.text === 'string' ? res.text.trim() : '';
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { createGeminiExplainer, SYSTEM_INSTRUCTION };

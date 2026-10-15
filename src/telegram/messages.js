'use strict';

const { formatForDisplay } = require('../time/format');

// Bot messages are in Romanian (D-04). Plain text only: no parse_mode, nothing to escape.

const DISCLAIMER =
  'FVIS este un instrument de cercetare. Probabilitățile sunt estimări ale unui model, cu limitări cunoscute. ' +
  '„QUALIFIED” înseamnă doar eligibil pentru urmărire și validare pe hârtie — nu sigur, nu garantat, nu profitabil.';

function startMessage() {
  return [
    'Bun venit în FVIS — Football Value Intelligence System.',
    '',
    'Stadiu actual: Faza 1 (schelet). Analiza meciurilor nu este încă disponibilă.',
    '',
    'Comenzi:',
    '/help — lista de comenzi',
    '/health — starea serviciului',
    '',
    DISCLAIMER,
  ].join('\n');
}

function helpMessage() {
  return [
    'Comenzi disponibile:',
    '/start — prezentare',
    '/help — această listă',
    '/health — starea serviciului',
    '',
    'Comenzi planificate (fazele următoare): /fixtures, /analyze, /scan, /quota.',
  ].join('\n');
}

/** @param {{ version: string, uptimeSeconds: number, now: Date }} status */
function healthMessage({ version, uptimeSeconds, now }) {
  return [
    'Stare: OK',
    `Versiune: ${version}`,
    `Rulează de: ${formatUptime(uptimeSeconds)}`,
    `Ora: ${formatForDisplay(now)}`,
  ].join('\n');
}

function unknownMessage() {
  return 'Comandă necunoscută. Trimite /help pentru lista de comenzi.';
}

function formatUptime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}z ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

module.exports = { startMessage, helpMessage, healthMessage, unknownMessage, formatUptime, DISCLAIMER };

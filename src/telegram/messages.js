'use strict';

const { formatForDisplay, DISPLAY_TIME_ZONE } = require('../time/format');
const { getCompetition } = require('../domain/competitions');

// Bot messages are in Romanian (D-04). Plain text only: no parse_mode, nothing to escape.

const DISCLAIMER =
  'FVIS este un instrument de cercetare. Probabilitățile sunt estimări ale unui model, cu limitări cunoscute. ' +
  '„QUALIFIED” înseamnă doar eligibil pentru urmărire și validare pe hârtie — nu sigur, nu garantat, nu profitabil.';

function startMessage() {
  return [
    'Bun venit în FVIS — Football Value Intelligence System.',
    '',
    'Stadiu actual: Faza 2 (date). Analiza meciurilor nu este încă disponibilă.',
    '',
    'Comenzi:',
    '/fixtures — meciurile următoare',
    '/quota — consumul surselor de date',
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
    '/fixtures — meciurile din următoarele 3 zile (toate competițiile)',
    '/fixtures <ligă> — meciurile din următoarele 7 zile pentru o ligă',
    '   ligi: epl, laliga, seriea, bundesliga, ligue1, ucl, uel',
    '/quota — credite de cote și cereri către surse',
    '',
    'Comenzi planificate (fazele următoare): /analyze, /scan.',
  ].join('\n');
}

/**
 * @param {{ version: string, uptimeSeconds: number, now: Date }} status
 * @param {{ state: 'connected' | 'not_configured' | 'error', competitions?: number }} [database]
 */
function healthMessage({ version, uptimeSeconds, now }, database = null) {
  const db = !database
    ? null
    : database.state === 'connected'
      ? `Bază de date: conectată (${database.competitions} competiții)`
      : database.state === 'not_configured'
        ? 'Bază de date: neconfigurată (lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'
        : 'Bază de date: eroare de conexiune (detalii în log-ul serviciului)';
  return [
    'Stare: OK',
    `Versiune: ${version}`,
    `Rulează de: ${formatUptime(uptimeSeconds)}`,
    `Ora: ${formatForDisplay(now)}`,
    ...(db ? [db] : []),
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

const LEAGUE_ALIASES = {
  epl: 'EPL', pl: 'EPL', premier: 'EPL', premierleague: 'EPL',
  laliga: 'LALIGA', liga: 'LALIGA', pd: 'LALIGA',
  seriea: 'SERIEA', serie: 'SERIEA', sa: 'SERIEA',
  bundesliga: 'BUNDESLIGA', bl: 'BUNDESLIGA', bl1: 'BUNDESLIGA',
  ligue1: 'LIGUE1', l1: 'LIGUE1', fl1: 'LIGUE1',
  ucl: 'UCL', cl: 'UCL', champions: 'UCL', championsleague: 'UCL',
  uel: 'UEL', el: 'UEL', europa: 'UEL', europaleague: 'UEL',
};

/** "Serie A" / "seriea" / "SA" → canonical code, or null. */
function parseLeague(arg) {
  const key = String(arg || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return LEAGUE_ALIASES[key] || null;
}

const kickoffFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: DISPLAY_TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const MAX_MESSAGE = 3800; // Telegram limit is 4096 characters

/**
 * Upcoming matches grouped by competition. UEFA competitions are marked informational (D-13).
 * @returns {string[]} one or more message chunks
 */
function fixturesMessages(items, { days, competitionCode = null }) {
  const header = competitionCode
    ? `Meciuri ${getCompetition(competitionCode).name} — următoarele ${days} zile (ora României)`
    : `Meciuri — următoarele ${days} zile (ora României)`;
  if (!items.length) return [`${header}\n\nNu există meciuri programate în acest interval.`];
  const blocks = [];
  const byComp = new Map();
  for (const it of items) {
    if (!byComp.has(it.competitionCode)) byComp.set(it.competitionCode, []);
    byComp.get(it.competitionCode).push(it);
  }
  for (const [code, list] of byComp) {
    const comp = getCompetition(code);
    const title = comp.modelApplicable ? comp.name : `${comp.name} (informativ, fără analiză de valoare)`;
    const lines = list.map((it) => `• ${kickoffFormatter.format(new Date(it.kickoffUtc))} — ${it.home} – ${it.away}`);
    blocks.push([title, ...lines].join('\n'));
  }
  // Pack lines into messages below the Telegram limit; a long competition block continues
  // in the next message rather than being truncated.
  const chunks = [];
  let current = header;
  const push = (piece, sep) => {
    if (current.length + sep.length + piece.length > MAX_MESSAGE) {
      chunks.push(current);
      current = piece;
    } else {
      current = `${current}${sep}${piece}`;
    }
  };
  for (const block of blocks) {
    const [title, ...lines] = block.split('\n');
    push(title, '\n\n');
    for (const line of lines) push(line, '\n');
  }
  chunks.push(current);
  return chunks;
}

function quotaMessage({ odds, requestsToday }) {
  return [
    `Cote (The Odds API) — luna ${odds.month}`,
    `Credite folosite: ${odds.used} din ${odds.monthlyLimit} (rezervă ${odds.reserve})`,
    `  • scanare zilnică: ${odds.scanner}`,
    `  • la cerere: ${odds.on_demand} din plafonul de ${odds.onDemandMonthlyCap}`,
    `  • altele: ${odds.other}`,
    `Credite rămase raportate de furnizor: ${odds.providerRemaining ?? 'necunoscut'}`,
    '',
    'Cereri azi (UTC):',
    `  • football-data.org: ${requestsToday.football_data_org || 0}`,
    `  • The Odds API: ${requestsToday.the_odds_api || 0}`,
    `  • football-data.co.uk: ${requestsToday.football_data_co_uk || 0}`,
  ].join('\n');
}

function dataUnavailableMessage() {
  return 'Datele nu sunt disponibile momentan (baza de date nu este configurată sau nu răspunde). Încearcă din nou mai târziu.';
}

function unknownLeagueMessage(arg) {
  return `Liga „${String(arg).slice(0, 32)}” nu este recunoscută. Variante: epl, laliga, seriea, bundesliga, ligue1, ucl, uel.`;
}

module.exports = {
  fixturesMessages,
  quotaMessage,
  dataUnavailableMessage,
  unknownLeagueMessage,
  parseLeague, startMessage, helpMessage, healthMessage, unknownMessage, formatUptime, DISCLAIMER };

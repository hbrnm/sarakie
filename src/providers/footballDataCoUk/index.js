'use strict';

const { createHttpClient } = require('../http');
const { createReport } = require('../report');
const { zonedTimeToUtc } = require('../../time/zone');
const { isValidDecimalOdds } = require('../../domain/markets');

const SOURCE = 'football_data_co_uk';
const DEFAULT_BASE_URL = 'https://www.football-data.co.uk';

// Division file codes for domestic leagues. No UEFA competitions exist in this source.
const DIVISIONS = Object.freeze({ EPL: 'E0', LALIGA: 'SP1', SERIEA: 'I1', BUNDESLIGA: 'D1', LIGUE1: 'F1' });

// Closing-odds column prefixes → bookmaker keys. `C` after the prefix = closing price.
const CLOSING_1X2 = [
  { prefix: 'B365C', bookmakerKey: 'bet365', bookmakerName: 'Bet365' },
  { prefix: 'PSC', bookmakerKey: 'pinnacle', bookmakerName: 'Pinnacle' },
  { prefix: 'AvgC', bookmakerKey: 'market_average', bookmakerName: 'Market average' },
  { prefix: 'MaxC', bookmakerKey: 'market_maximum', bookmakerName: 'Market maximum' },
];
const CLOSING_OU25 = [
  { over: 'B365C>2.5', under: 'B365C<2.5', bookmakerKey: 'bet365', bookmakerName: 'Bet365' },
  { over: 'PC>2.5', under: 'PC<2.5', bookmakerKey: 'pinnacle', bookmakerName: 'Pinnacle' },
  { over: 'AvgC>2.5', under: 'AvgC<2.5', bookmakerKey: 'market_average', bookmakerName: 'Market average' },
  { over: 'MaxC>2.5', under: 'MaxC<2.5', bookmakerKey: 'market_maximum', bookmakerName: 'Market maximum' },
];

/** Season start year → file season code, e.g. 2026 → "2627". */
function seasonCode(startYear) {
  const two = (n) => String(n % 100).padStart(2, '0');
  return `${two(startYear)}${two(startYear + 1)}`;
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseNumber(s) {
  if (s === undefined || s === null || String(s).trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "dd/mm/yy(yy)" + optional "HH:MM" (UK local time) → UTC ISO string. */
function parseKickoff(dateStr, timeStr) {
  const d = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec((dateStr || '').trim());
  if (!d) return null;
  const year = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  const t = /^(\d{2}):(\d{2})$/.exec((timeStr || '').trim());
  // Without a time column, noon UK time is used so the UTC date stays correct.
  const [hour, minute] = t ? [Number(t[1]), Number(t[2])] : [12, 0];
  return zonedTimeToUtc({ year, month: Number(d[2]), day: Number(d[1]), hour, minute }, 'Europe/London').toISOString();
}

/**
 * Parses a season CSV into finished fixtures and closing-odds quotes.
 * @returns {{ fixtures: import('../../domain/types').Fixture[], closingQuotes: import('../../domain/types').OddsQuote[], report: object, columns: string[] }}
 */
function parseSeasonCsv(text, { competitionCode, season, capturedAt }) {
  const rows = parseCsv(text);
  const header = (rows[0] || []).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const col = (row, name) => (idx[name] === undefined ? undefined : row[idx[name]]);
  const report = createReport();
  const fixtures = [];
  const closingQuotes = [];

  for (const row of rows.slice(1)) {
    report.received();
    const home = (col(row, 'HomeTeam') || '').trim();
    const away = (col(row, 'AwayTeam') || '').trim();
    const kickoffUtc = parseKickoff(col(row, 'Date'), col(row, 'Time'));
    const hg = parseNumber(col(row, 'FTHG'));
    const ag = parseNumber(col(row, 'FTAG'));
    if (!home || !away) {
      report.drop('TEAMS_MISSING');
      continue;
    }
    if (!kickoffUtc) {
      report.drop('DATE_INVALID');
      continue;
    }
    if (hg === null || ag === null || !Number.isInteger(hg) || !Number.isInteger(ag) || hg < 0 || ag < 0) {
      report.drop('SCORE_MISSING');
      continue;
    }
    report.accept();
    const providerFixtureId = `${competitionCode}:${season}:${kickoffUtc.slice(0, 10)}:${home}:${away}`;
    fixtures.push({
      sourceProvider: SOURCE,
      providerFixtureId,
      competitionCode,
      season,
      kickoffUtc,
      status: 'FINISHED',
      home: { providerTeamId: null, name: home, shortName: null, tla: null },
      away: { providerTeamId: null, name: away, shortName: null, tla: null },
      homeGoals: hg,
      awayGoals: ag,
      matchday: null,
      stage: null,
    });

    const base = { sourceProvider: SOURCE, providerEventId: providerFixtureId, competitionCode, kickoffUtc, homeTeamName: home, awayTeamName: away, sourceTimestamp: null, capturedAt, kind: 'closing' };
    for (const b of CLOSING_1X2) {
      const prices = ['H', 'D', 'A'].map((s) => parseNumber(col(row, `${b.prefix}${s}`)));
      if (prices.some((p) => !isValidDecimalOdds(p))) continue; // complete sets only
      ['HOME', 'DRAW', 'AWAY'].forEach((sel, i) =>
        closingQuotes.push({ ...base, bookmakerKey: b.bookmakerKey, bookmakerName: b.bookmakerName, marketCode: '1X2', selectionCode: sel, line: null, decimalOdds: prices[i] }),
      );
    }
    for (const b of CLOSING_OU25) {
      const over = parseNumber(col(row, b.over));
      const under = parseNumber(col(row, b.under));
      if (!isValidDecimalOdds(over) || !isValidDecimalOdds(under)) continue;
      closingQuotes.push({ ...base, bookmakerKey: b.bookmakerKey, bookmakerName: b.bookmakerName, marketCode: 'OU', selectionCode: 'OVER', line: 2.5, decimalOdds: over });
      closingQuotes.push({ ...base, bookmakerKey: b.bookmakerKey, bookmakerName: b.bookmakerName, marketCode: 'OU', selectionCode: 'UNDER', line: 2.5, decimalOdds: under });
    }
  }
  return { fixtures, closingQuotes, report: report.value(), columns: header };
}

/**
 * @param {{ baseUrl?: string, http?: ReturnType<typeof createHttpClient>, now?: () => Date, onRequest?: Function }} [options]
 */
function createFootballDataCoUkAdapter({ baseUrl = DEFAULT_BASE_URL, http, now = () => new Date(), onRequest } = {}) {
  const client = http || createHttpClient({ provider: SOURCE, onRequest });
  const base = baseUrl.replace(/\/+$/, '');
  return {
    source: SOURCE,
    supports: (competitionCode) => Object.hasOwn(DIVISIONS, competitionCode),
    /** Finished matches + closing odds for one league season. */
    async getSeason({ competitionCode, season }) {
      const div = DIVISIONS[competitionCode];
      if (!div) {
        const err = new Error(`competition ${competitionCode} not available from ${SOURCE}`);
        err.code = 'NO_PROVIDER_COVERAGE';
        throw err;
      }
      const res = await client.get(`${base}/mmz4281/${seasonCode(season)}/${div}.csv`, { as: 'text' });
      return parseSeasonCsv(res.body, { competitionCode, season, capturedAt: now().toISOString() });
    },
  };
}

module.exports = { createFootballDataCoUkAdapter, parseCsv, parseSeasonCsv, parseKickoff, seasonCode, DIVISIONS, SOURCE };

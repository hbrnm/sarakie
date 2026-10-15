'use strict';

const { z } = require('zod');
const { createHttpClient } = require('../http');
const { createReport } = require('../report');
const { isValidDecimalOdds, isValidSelection } = require('../../domain/markets');

const SOURCE = 'the_odds_api';
const DEFAULT_BASE_URL = 'https://api.the-odds-api.com/v4';
const REGION = 'eu';

// Discovery rules: provider sport title → canonical code (soccer group, no outrights).
const DISCOVERY = [
  { code: 'EPL', title: /^(epl|premier league)\b/i },
  { code: 'LALIGA', title: /^la ?liga\b(?!.*\b2\b)/i },
  { code: 'SERIEA', title: /^serie a\b/i },
  { code: 'BUNDESLIGA', title: /^bundesliga\b(?!.*\b2\b)/i },
  { code: 'LIGUE1', title: /^ligue 1\b/i },
  { code: 'UCL', title: /^uefa champions league$/i },
  { code: 'UEL', title: /^uefa europa league$/i },
];

// Provider market key → canonical market code.
const MARKET_MAP = {
  h2h: '1X2',
  totals: 'OU',
  alternate_totals: 'OU',
  btts: 'BTTS',
  draw_no_bet: 'DNB',
  double_chance: 'DC',
};

const outcome = z.object({ name: z.string(), price: z.number(), point: z.number().optional() });
const eventSchema = z.object({
  id: z.string().min(1),
  sport_key: z.string(),
  commence_time: z.iso.datetime({ offset: true }),
  home_team: z.string().min(1),
  away_team: z.string().min(1),
  bookmakers: z
    .array(
      z.object({
        key: z.string(),
        title: z.string(),
        last_update: z.string().optional(),
        markets: z.array(z.object({ key: z.string(), last_update: z.string().optional(), outcomes: z.array(outcome) })),
      }),
    )
    .default([]),
});
const sportSchema = z.object({
  key: z.string(),
  group: z.string(),
  title: z.string(),
  active: z.boolean().optional(),
  has_outrights: z.boolean().optional(),
});

const norm = (s) => s.trim().toLowerCase();

/**
 * Maps a provider outcome to a canonical selection.
 * Double-chance outcome naming is UNVERIFIED (S-52): team-name pairs and Home/Draw/Away
 * forms are both accepted; anything else is dropped and counted.
 */
function mapSelection(marketCode, name, home, away) {
  const n = norm(name);
  const side = (x) => (x === norm(home) || x === 'home' ? 'H' : x === norm(away) || x === 'away' ? 'A' : x === 'draw' ? 'D' : null);
  switch (marketCode) {
    case '1X2':
      return { H: 'HOME', D: 'DRAW', A: 'AWAY' }[side(n)] || null;
    case 'DNB':
      return { H: 'HOME', A: 'AWAY' }[side(n)] || null;
    case 'OU':
      return n === 'over' ? 'OVER' : n === 'under' ? 'UNDER' : null;
    case 'BTTS':
      return n === 'yes' ? 'YES' : n === 'no' ? 'NO' : null;
    case 'DC': {
      const parts = n.split(/\s*(?:\/| or )\s*/);
      if (parts.length !== 2) return null;
      const key = parts.map(side).sort().join('');
      return { DH: '1X', AH: '12', AD: 'X2' }[key] || null;
    }
    default:
      return null;
  }
}

/**
 * Normalizes one provider event into OddsQuote[].
 * @returns {{ quotes: import('../../domain/types').OddsQuote[], event: object } | { reason: string }}
 */
function normalizeEvent(raw, competitionCode, capturedAt, report) {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return { reason: 'SCHEMA_INVALID' };
  const e = parsed.data;
  const kickoffUtc = new Date(e.commence_time).toISOString();
  const quotes = [];
  for (const bm of e.bookmakers) {
    for (const m of bm.markets) {
      const marketCode = MARKET_MAP[m.key];
      if (!marketCode) continue; // out-of-scope market (corners, halves, props…)
      for (const o of m.outcomes) {
        report.received();
        const selectionCode = mapSelection(marketCode, o.name, e.home_team, e.away_team);
        const line = marketCode === 'OU' ? (o.point ?? null) : null;
        if (!selectionCode) {
          report.drop('UNMAPPED_SELECTION');
          continue;
        }
        if (!isValidSelection(marketCode, selectionCode, line)) {
          report.drop(marketCode === 'OU' ? 'OU_LINE_OUT_OF_SCOPE' : 'INVALID_SELECTION');
          continue;
        }
        if (!isValidDecimalOdds(o.price)) {
          report.drop('ODDS_INVALID');
          continue;
        }
        report.accept();
        quotes.push({
          sourceProvider: SOURCE,
          providerEventId: e.id,
          competitionCode,
          kickoffUtc,
          homeTeamName: e.home_team,
          awayTeamName: e.away_team,
          bookmakerKey: bm.key,
          bookmakerName: bm.title,
          marketCode,
          selectionCode,
          line,
          decimalOdds: o.price,
          sourceTimestamp: m.last_update || bm.last_update || null,
          capturedAt,
          kind: 'pre_match',
        });
      }
    }
  }
  return {
    quotes,
    event: { providerEventId: e.id, competitionCode, kickoffUtc, homeTeamName: e.home_team, awayTeamName: e.away_team },
  };
}

function creditHeaders(headers) {
  const num = (h) => {
    const v = headers && headers.get(h);
    return v === null || v === undefined || v === '' ? null : Number(v);
  };
  return { last: num('x-requests-last'), remaining: num('x-requests-remaining'), used: num('x-requests-used') };
}

/**
 * @param {{
 *   apiKey: string,
 *   budget: ReturnType<typeof import('./creditBudget').createCreditBudget>,
 *   baseUrl?: string,
 *   http?: ReturnType<typeof createHttpClient>,
 *   now?: () => Date,
 *   onRequest?: (entry: object) => void,
 * }} options
 */
function createOddsApiAdapter({ apiKey, budget, baseUrl = DEFAULT_BASE_URL, http, now = () => new Date(), onRequest }) {
  if (!apiKey) throw new Error('The Odds API adapter requires an API key');
  if (!budget) throw new Error('The Odds API adapter requires a credit budget');
  const client = http || createHttpClient({ provider: SOURCE, secrets: [apiKey], onRequest });
  const base = baseUrl.replace(/\/+$/, '');
  let discovered = null;

  async function get(path, params) {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('apiKey', apiKey);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
    return client.get(url);
  }

  /** Paid call: budget is checked first and the provider-reported cost recorded after. */
  async function paidGet(path, params, { purpose, estimatedCredits }) {
    const decision = await budget.check(purpose, estimatedCredits);
    if (!decision.allowed) {
      const err = new Error(`odds request refused by credit budget: ${decision.reason}`);
      err.code = 'CREDIT_BUDGET';
      err.reason = decision.reason;
      throw err;
    }
    const res = await get(path, params);
    const credits = creditHeaders(res.headers);
    await budget.record(purpose, credits.last ?? estimatedCredits, credits.remaining);
    return { body: res.body, credits };
  }

  async function listCompetitions() {
    const res = await get('/sports'); // reported free of credit cost (verified in Phase 2b)
    const items = Array.isArray(res.body) ? res.body : [];
    const found = new Map();
    for (const raw of items) {
      const p = sportSchema.safeParse(raw);
      if (!p.success) continue;
      const s = p.data;
      if (!/soccer/i.test(s.group) || s.has_outrights) continue;
      const rule = DISCOVERY.find((d) => d.title.test(s.title));
      if (rule && !found.has(rule.code)) {
        found.set(rule.code, {
          competitionCode: rule.code,
          sourceProvider: SOURCE,
          providerCompetitionId: s.key,
          providerName: s.title,
          active: s.active ?? null,
        });
      }
    }
    discovered = found;
    return [...found.values()];
  }

  async function sportKeyFor(competitionCode) {
    if (!discovered) await listCompetitions();
    const c = discovered.get(competitionCode);
    if (!c) {
      const err = new Error(`competition ${competitionCode} not available from ${SOURCE}`);
      err.code = 'NO_PROVIDER_COVERAGE';
      throw err;
    }
    return c.providerCompetitionId;
  }

  function normalizeAll(items, competitionCode) {
    const capturedAt = now().toISOString();
    const report = createReport();
    const quotes = [];
    const events = [];
    let invalidEvents = 0;
    for (const raw of items) {
      const r = normalizeEvent(raw, competitionCode, capturedAt, report);
      if (r.reason) {
        invalidEvents += 1;
        continue;
      }
      quotes.push(...r.quotes);
      events.push(r.event);
    }
    return { quotes, events, report: { ...report.value(), invalidEvents } };
  }

  return {
    source: SOURCE,
    listCompetitions,
    /** Scanner call: 1X2 + main O/U for all upcoming events of a competition (≈2 credits). */
    async getFeaturedOdds({ competitionCode, purpose = 'scanner' }) {
      const key = await sportKeyFor(competitionCode);
      const { body, credits } = await paidGet(
        `/sports/${key}/odds`,
        { regions: REGION, markets: 'h2h,totals', oddsFormat: 'decimal', dateFormat: 'iso' },
        { purpose, estimatedCredits: 2 },
      );
      return { ...normalizeAll(Array.isArray(body) ? body : [], competitionCode), credits };
    },
    /** Upcoming events without odds (reported as free; the actual cost is still recorded). */
    async listEvents({ competitionCode, purpose = 'scanner' }) {
      const key = await sportKeyFor(competitionCode);
      const { body, credits } = await paidGet(`/sports/${key}/events`, { dateFormat: 'iso' }, { purpose, estimatedCredits: 0 });
      const events = [];
      for (const raw of Array.isArray(body) ? body : []) {
        const p = eventSchema.safeParse({ ...raw, bookmakers: [] });
        if (!p.success) continue;
        const e = p.data;
        events.push({ providerEventId: e.id, competitionCode, kickoffUtc: new Date(e.commence_time).toISOString(), homeTeamName: e.home_team, awayTeamName: e.away_team });
      }
      return { events, credits };
    },
    /** On-demand call: extra markets for one event (≈1 credit per market returned). */
    async getEventOdds({ competitionCode, providerEventId, markets = ['btts', 'draw_no_bet', 'double_chance', 'alternate_totals'], purpose = 'on_demand' }) {
      const key = await sportKeyFor(competitionCode);
      const { body, credits } = await paidGet(
        `/sports/${key}/events/${encodeURIComponent(providerEventId)}/odds`,
        { regions: REGION, markets: markets.join(','), oddsFormat: 'decimal', dateFormat: 'iso' },
        { purpose, estimatedCredits: markets.length },
      );
      return { ...normalizeAll(body ? [body] : [], competitionCode), credits };
    },
  };
}

module.exports = { createOddsApiAdapter, normalizeEvent, mapSelection, SOURCE };

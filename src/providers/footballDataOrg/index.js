'use strict';

const { z } = require('zod');
const { createHttpClient, createIntervalLimiter } = require('../http');
const { createReport } = require('../report');

const SOURCE = 'football_data_org';
const DEFAULT_BASE_URL = 'https://api.football-data.org/v4';

// Discovery rules: provider competition name (+ area for domestic leagues) → canonical code.
const DISCOVERY = [
  { code: 'EPL', name: /^premier league$/i, area: 'England' },
  { code: 'LALIGA', name: /^(primera divisi[oó]n|la ?liga)$/i, area: 'Spain' },
  { code: 'SERIEA', name: /^serie a$/i, area: 'Italy' },
  { code: 'BUNDESLIGA', name: /^bundesliga$/i, area: 'Germany' },
  { code: 'LIGUE1', name: /^ligue 1$/i, area: 'France' },
  { code: 'UCL', name: /^uefa champions league$/i, area: null },
  { code: 'UEL', name: /^uefa europa league$/i, area: null },
];

const STATUS_MAP = {
  SCHEDULED: 'SCHEDULED',
  TIMED: 'SCHEDULED',
  IN_PLAY: 'LIVE',
  PAUSED: 'LIVE',
  LIVE: 'LIVE',
  FINISHED: 'FINISHED',
  POSTPONED: 'POSTPONED',
  SUSPENDED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
  AWARDED: 'AWARDED',
};

const score = z.object({ home: z.number().int().min(0).nullable(), away: z.number().int().min(0).nullable() });
const team = z.object({
  id: z.number().int().nullable(),
  name: z.string().min(1).nullable(),
  shortName: z.string().nullable().optional(),
  tla: z.string().nullable().optional(),
});
const matchSchema = z.object({
  id: z.number().int(),
  utcDate: z.iso.datetime({ offset: true }),
  status: z.string(),
  matchday: z.number().int().nullable().optional(),
  stage: z.string().nullable().optional(),
  season: z.object({ startDate: z.iso.date() }),
  homeTeam: team,
  awayTeam: team,
  score: z.object({
    duration: z.string().optional(),
    fullTime: score,
    regularTime: score.nullable().optional(),
  }),
});
const competitionSchema = z.object({
  id: z.number().int(),
  code: z.string().nullable().optional(),
  name: z.string(),
  area: z.object({ name: z.string() }).optional(),
  currentSeason: z.object({ startDate: z.iso.date() }).nullable().optional(),
});
const teamSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  shortName: z.string().nullable().optional(),
  tla: z.string().nullable().optional(),
});

/** @returns {import('../../domain/types').TeamRef} */
function toTeamRef(t) {
  return { providerTeamId: String(t.id), name: t.name, shortName: t.shortName ?? null, tla: t.tla ?? null };
}

/**
 * Normalizes one provider match. Returns null (with a reason) when it cannot be used.
 * @returns {{ fixture: import('../../domain/types').Fixture } | { reason: string }}
 */
function normalizeMatch(raw, competitionCode) {
  const parsed = matchSchema.safeParse(raw);
  if (!parsed.success) return { reason: 'SCHEMA_INVALID' };
  const m = parsed.data;
  const status = STATUS_MAP[m.status];
  if (!status) return { reason: 'UNKNOWN_STATUS' };
  if (m.homeTeam.id === null || !m.homeTeam.name || m.awayTeam.id === null || !m.awayTeam.name) {
    return { reason: 'TEAMS_TBD' };
  }
  let homeGoals = null;
  let awayGoals = null;
  if (status === 'FINISHED') {
    // Regular time only: knockout matches may include extra time in fullTime.
    const regular = !m.score.duration || m.score.duration === 'REGULAR' ? m.score.fullTime : m.score.regularTime;
    if (!regular || regular.home === null || regular.away === null) return { reason: 'FINISHED_WITHOUT_SCORE' };
    homeGoals = regular.home;
    awayGoals = regular.away;
  }
  return {
    fixture: {
      sourceProvider: SOURCE,
      providerFixtureId: String(m.id),
      competitionCode,
      season: Number(m.season.startDate.slice(0, 4)),
      kickoffUtc: new Date(m.utcDate).toISOString(),
      status,
      home: toTeamRef(m.homeTeam),
      away: toTeamRef(m.awayTeam),
      homeGoals,
      awayGoals,
      matchday: m.matchday ?? null,
      stage: m.stage ?? null,
    },
  };
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl?: string,
 *   http?: ReturnType<typeof createHttpClient>,
 *   limiter?: () => Promise<void>,
 *   onRequest?: (entry: object) => void,
 * }} options
 */
function createFootballDataOrgAdapter({ apiKey, baseUrl = DEFAULT_BASE_URL, http, limiter, onRequest }) {
  if (!apiKey) throw new Error('football-data.org adapter requires an API key');
  const client = http || createHttpClient({ provider: SOURCE, secrets: [apiKey], onRequest });
  const wait = limiter || createIntervalLimiter(6500); // free tier: 10 requests/minute
  const base = baseUrl.replace(/\/+$/, '');
  let discovered = null;

  async function get(path, params = {}) {
    await wait();
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await client.get(url, { headers: { 'X-Auth-Token': apiKey } });
    return res.body;
  }

  /** Discovers provider competitions for the canonical codes. */
  async function listCompetitions() {
    const body = await get('/competitions');
    const items = Array.isArray(body && body.competitions) ? body.competitions : [];
    const found = new Map();
    for (const raw of items) {
      const parsed = competitionSchema.safeParse(raw);
      if (!parsed.success) continue;
      const c = parsed.data;
      const rule = DISCOVERY.find((d) => d.name.test(c.name) && (d.area === null || (c.area && c.area.name === d.area)));
      if (rule && !found.has(rule.code)) {
        found.set(rule.code, {
          competitionCode: rule.code,
          sourceProvider: SOURCE,
          providerCompetitionId: String(c.id),
          providerCode: c.code ?? null,
          providerName: c.name,
          currentSeason: c.currentSeason ? Number(c.currentSeason.startDate.slice(0, 4)) : null,
        });
      }
    }
    discovered = found;
    return [...found.values()];
  }

  async function providerIdFor(competitionCode) {
    if (!discovered) await listCompetitions();
    const c = discovered.get(competitionCode);
    if (!c) {
      const err = new Error(`competition ${competitionCode} not available from ${SOURCE}`);
      err.code = 'NO_PROVIDER_COVERAGE';
      throw err;
    }
    return c.providerCompetitionId;
  }

  async function fetchMatches(competitionCode, params) {
    const id = await providerIdFor(competitionCode);
    const body = await get(`/competitions/${id}/matches`, params);
    const items = Array.isArray(body && body.matches) ? body.matches : [];
    const report = createReport();
    const fixtures = [];
    for (const raw of items) {
      report.received();
      const r = normalizeMatch(raw, competitionCode);
      if (r.fixture) {
        report.accept();
        fixtures.push(r.fixture);
      } else {
        report.drop(r.reason);
      }
    }
    return { fixtures, report: report.value() };
  }

  return {
    source: SOURCE,
    listCompetitions,
    /** Fixtures with kickoff dates in [from, to] (YYYY-MM-DD, UTC). */
    listFixtures: ({ competitionCode, from, to }) => fetchMatches(competitionCode, { dateFrom: from, dateTo: to }),
    /** Finished matches of a season (start year). */
    listResults: ({ competitionCode, season }) => fetchMatches(competitionCode, { season, status: 'FINISHED' }),
    async listTeams({ competitionCode, season }) {
      const id = await providerIdFor(competitionCode);
      const body = await get(`/competitions/${id}/teams`, season ? { season } : {});
      const items = Array.isArray(body && body.teams) ? body.teams : [];
      return items.map((t) => teamSchema.safeParse(t)).filter((p) => p.success).map((p) => toTeamRef(p.data));
    },
  };
}

module.exports = { createFootballDataOrgAdapter, normalizeMatch, SOURCE };

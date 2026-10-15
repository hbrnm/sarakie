'use strict';

const { COMPETITIONS, getCompetition } = require('../domain/competitions');
const { createTeamMatcher } = require('../domain/teams/matching');
const { MODEL_FAMILY, MODEL_VERSION, defaultConfig, configHash } = require('../domain/model/config');
const { RISK_VERSION, defaultRiskConfig, riskConfigHash } = require('../domain/risk/config');
const { marketConsensus } = require('../domain/odds/consensus');
const { analyzeFixture, ALL_MARKETS } = require('./analyzeFixture');
const { evaluateLineShopping } = require('../domain/lineShopping');
const { defaultLineConfig } = require('../domain/lineShopping/config');
const { lineSectionLines } = require('../telegram/lineView');
const { recordAnalysis } = require('./record');
const { marketViewMessage } = require('../telegram/marketView');
const { formatKickoff } = require('../time/format');

const DOMESTIC = COMPETITIONS.filter((c) => c.modelApplicable).map((c) => c.code);
const CUPS = COMPETITIONS.filter((c) => !c.modelApplicable).map((c) => c.code);
const DAY = 86400000;
const HORIZON_DAYS = 7;
const FRESH_MS = 2 * 3600 * 1000; // on-demand freshness (option A, risk config maxOddsAgeOnDemandMinutes)
const LINK_TOLERANCE_MS = 3 * 3600 * 1000;
// D-16: one event-odds call with every in-scope market.
const EVENT_MARKETS = Object.freeze(['h2h', 'totals', 'alternate_totals', 'btts', 'draw_no_bet', 'double_chance']);
const ON_DEMAND_ONLY = new Set(['DC', 'DNB', 'BTTS']); // only an on-demand fetch captures these

const USAGE = 'Folosire: /analyze <gazde> - <oaspeți>, de ex. /analyze Arsenal - Chelsea (sau /analyze Arsenal Chelsea).';

/**
 * Parses "/analyze" arguments: "Home - Away", "Home vs Away", or two single words.
 * A single name is returned as { team } (all upcoming matches of that team are listed).
 * @returns {{ home: string, away: string, whole?: string } | { team: string } | null}
 */
function parseMatchQuery(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!t) return null;
  const parts = t.split(/\s+(?:-|–|—|vs\.?|v)\s+/i);
  if (parts.length === 2 && parts[0] && parts[1]) return { home: parts[0].trim(), away: parts[1].trim() };
  if (parts.length > 2) return null;
  const words = t.split(' ');
  // "Arsenal Chelsea" is two teams, but "Bayern München" is one: the caller retries as one team.
  if (words.length === 2) return { home: words[0], away: words[1], whole: t };
  return { team: t };
}

/**
 * Resolves a query to one domestic fixture, one UCL/UEL event, a list of candidates, or nothing.
 * Never guesses: ambiguous names produce a list (CLAUDE.md §4.4, matching rules in domain/teams).
 */
async function resolveMatch(query, { store, now }) {
  const to = new Date(now.getTime() + HORIZON_DAYS * DAY);
  const fixtures = await store.upcomingFixtures({ from: now, to, competitionCodes: DOMESTIC });
  const teamIds = [...new Set(fixtures.flatMap((f) => [f.homeTeamId, f.awayTeamId]))];
  const aliases = await store.teamAliases(teamIds);
  const matcher = createTeamMatcher(teamIds.map((id) => ({ id, names: aliases.get(id) || [] })));
  const label = async (f) => `${await store.teamName(f.homeTeamId)} – ${await store.teamName(f.awayTeamId)} (${getCompetition(f.competitionCode).name}, ${formatKickoff(new Date(f.kickoffUtc))})`;
  const choices = async (list) => ({ kind: 'choices', items: await Promise.all(list.slice(0, 10).map(label)) });

  const sides = 'team' in query ? [query.team] : [query.home, query.away];
  const matched = sides.map((name) => matcher.match(name));
  if (matched.some((m) => m.reason === 'AMBIGUOUS')) {
    const ids = new Set(matched.flatMap((m) => (m.reason === 'AMBIGUOUS' ? m.candidates : m.teamId ? [m.teamId] : [])));
    const list = fixtures.filter((f) => ids.has(f.homeTeamId) || ids.has(f.awayTeamId));
    if (list.length === 1) return { kind: 'fixture', fixture: list[0] };
    if (list.length) return choices(list);
  }
  if ('team' in query && matched[0].teamId) {
    const list = fixtures.filter((f) => f.homeTeamId === matched[0].teamId || f.awayTeamId === matched[0].teamId);
    if (list.length === 1) return { kind: 'fixture', fixture: list[0] };
    if (list.length > 1) return choices(list);
  }
  if (!('team' in query) && matched[0].teamId && matched[1].teamId) {
    const [h, a] = [matched[0].teamId, matched[1].teamId];
    const fx = fixtures.find((f) => f.homeTeamId === h && f.awayTeamId === a) || fixtures.find((f) => f.homeTeamId === a && f.awayTeamId === h);
    if (fx) return { kind: 'fixture', fixture: fx };
  }

  // D-19: UCL/UEL matches (odds events; the model does not apply).
  const events = await store.upcomingOddsEvents({ from: now, to, competitionCodes: CUPS });
  const names = [...new Set(events.flatMap((e) => [e.homeTeamName, e.awayTeamName]))];
  const cupMatcher = createTeamMatcher(names.map((n) => ({ id: n, names: [n] })));
  const cm = sides.map((name) => cupMatcher.match(name));
  const hits = events.filter((e) => cm.every((m) => m.teamId && (m.teamId === e.homeTeamName || m.teamId === e.awayTeamName)));
  if (hits.length === 1) return { kind: 'cup', event: hits[0] };
  if (hits.length > 1) {
    return { kind: 'choices', items: hits.slice(0, 10).map((e) => `${e.homeTeamName} – ${e.awayTeamName} (${getCompetition(e.competitionCode).name}, ${formatKickoff(new Date(e.kickoffUtc))})`) };
  }
  return { kind: 'not_found' };
}

/**
 * On-demand analysis (Phase 5.3, `/analyze`). Same pipeline as the scanner (analyzeFixture),
 * mode `on_demand`: fresh odds for every market (≤ 2 h, D-16), Gemini commentary if
 * configured, predictions recorded append-only.
 *
 * @param {{
 *   store: ReturnType<typeof import('../persistence/analysisStore').createAnalysisStore>,
 *   repo?: ReturnType<typeof import('../persistence/repositories').createRepositories> | null,
 *   odds?: ReturnType<typeof import('../providers/oddsApi').createOddsApiAdapter> | null,
 *   budget?: { usage: () => Promise<object> } | null,
 *   gemini?: object | null,
 *   logger?: object | null,
 *   now?: () => Date,
 * }} deps
 */
function createOnDemandAnalyzer({ store, repo = null, odds = null, budget = null, gemini = null, logger = null, now = () => new Date() }) {
  const inflight = new Map(); // fixture id → promise: a double tap does not pay twice

  async function ensureEventId(fixture) {
    const linked = await store.linkedEventIds(fixture.id);
    if (linked.length) return linked[0];
    const { events } = await odds.listEvents({ competitionCode: fixture.competitionCode, purpose: 'on_demand' });
    if (repo) await repo.upsertOddsEvents(odds.source, events);
    const aliases = await store.teamAliases([fixture.homeTeamId, fixture.awayTeamId]);
    const matcher = createTeamMatcher([fixture.homeTeamId, fixture.awayTeamId].map((id) => ({ id, names: aliases.get(id) || [] })));
    const ev = events.find(
      (e) =>
        matcher.match(e.homeTeamName).teamId === fixture.homeTeamId &&
        matcher.match(e.awayTeamName).teamId === fixture.awayTeamId &&
        Math.abs(Date.parse(e.kickoffUtc) - Date.parse(fixture.kickoffUtc)) <= LINK_TOLERANCE_MS,
    );
    if (!ev) return null;
    if (repo) await repo.linkOddsEvents(odds.source, [{ providerEventId: ev.providerEventId, fixtureId: fixture.id }]);
    return ev.providerEventId;
  }

  /** Fetches fresh odds unless an on-demand batch younger than 2 h exists. */
  async function refreshOdds(fixture, t) {
    const recent = await store.loadQuotes({ fixtureId: fixture.id, since: new Date(t.getTime() - FRESH_MS) });
    const reused = recent.filter((q) => ON_DEMAND_ONLY.has(q.marketCode));
    if (reused.length) return { credits: 0, note: `cote refolosite (descărcate la ${formatKickoff(new Date(reused.map((q) => q.capturedAt).sort().pop()))})` };
    if (!odds) return { credits: 0, note: 'cotele nu pot fi actualizate (ODDS_API_KEY nu este configurat pe server)' };
    try {
      const eventId = await ensureEventId(fixture);
      if (!eventId) return { credits: 0, note: 'meciul nu a fost găsit la furnizorul de cote' };
      const r = await odds.getEventOdds({ competitionCode: fixture.competitionCode, providerEventId: eventId, markets: [...EVENT_MARKETS], purpose: 'on_demand' });
      if (repo) {
        await repo.upsertOddsEvents(odds.source, r.events);
        await repo.insertOddsSnapshots(r.quotes, { fixtureIdByEvent: new Map([[eventId, fixture.id]]) });
      }
      const credits = r.credits && Number.isFinite(r.credits.last) ? r.credits.last : EVENT_MARKETS.length;
      return { credits, note: `cote descărcate acum (${credits} credite)` };
    } catch (err) {
      if (err.code === 'CREDIT_BUDGET') return { credits: 0, note: 'plafonul lunar de credite pentru analize la cerere este atins; se folosesc cotele existente' };
      if (logger) logger.error('analyze.odds_failed', { fixtureId: fixture.id, error: err && err.message });
      return { credits: 0, note: 'cotele nu au putut fi actualizate (eroare la furnizor); se folosesc cotele existente' };
    }
  }

  async function analyzeResolved(fixture, t) {
    const { credits, note } = await refreshOdds(fixture, t);
    const modelConfig = defaultConfig();
    const modelVersionId = await store.ensureModelVersion({ modelFamily: MODEL_FAMILY, modelVersion: MODEL_VERSION, config: modelConfig, configHash: configHash(modelConfig) });
    const runId = await store.startRun({ trigger: 'on_demand', asOf: t, modelVersionId, riskVersion: RISK_VERSION, riskConfigHash: riskConfigHash(defaultRiskConfig()) });
    try {
      const result = await analyzeFixture({ fixture, mode: 'on_demand', now: t, fetchedMarkets: [...ALL_MARKETS], explain: true }, { store, gemini, logger });
      const rec = await recordAnalysis(store, { runId, modelVersionId, result });
      await store.finishRun(runId, { status: 'OK', finishedAt: now(), counts: { considered: 1, analyzed: 1, recorded: rec.recorded ? 1 : 0, credits } });
      let usage = null;
      if (budget) usage = await budget.usage().catch(() => null);
      // D-24: line-shopping view of the same odds (shown only; the paper test records scanner rows).
      const lineConfig = { ...defaultLineConfig(), maxOddsAgeMinutes: defaultRiskConfig().maxOddsAgeOnDemandMinutes };
      const quotes = await store.loadQuotes({ fixtureId: fixture.id, since: new Date(t.getTime() - lineConfig.maxOddsAgeMinutes * 60000) });
      const line = evaluateLineShopping({ quotes, kickoffUtc: fixture.kickoffUtc, now: t, config: lineConfig });
      const footer = [`Cote: ${note}.`];
      if (usage) footer.push(`Credite la cerere luna aceasta: ${usage.on_demand} din ${usage.onDemandMonthlyCap}.`);
      return `${result.explanation.text}\n\n${lineSectionLines(line).join('\n')}\n\n${footer.join(' ')}`;
    } catch (err) {
      await store.finishRun(runId, { status: 'FAILED', finishedAt: now(), counts: { considered: 1, credits }, errorSummary: `${err.code || 'ERROR'}: ${err.message}` }).catch(() => {});
      throw err;
    }
  }

  /** @returns {Promise<string>} the reply text */
  async function analyze(text) {
    const query = parseMatchQuery(text);
    if (!query) return USAGE;
    const t = now();
    let r = await resolveMatch(query, { store, now: t });
    if (r.kind === 'not_found' && query.whole) r = await resolveMatch({ team: query.whole }, { store, now: t });
    if (r.kind === 'not_found') return `Nu găsesc meciul în următoarele ${HORIZON_DAYS} zile. ${USAGE}\nVezi /fixtures pentru meciurile disponibile.`;
    if (r.kind === 'choices') return ['Am găsit mai multe meciuri. Scrie numele mai exact:', ...r.items.map((i) => `• ${i}`)].join('\n');
    if (r.kind === 'cup') {
      const quotes = await store.loadEventQuotes({ eventIds: [r.event.providerEventId], since: new Date(t.getTime() - DAY) });
      return marketViewMessage({ event: r.event, consensus: marketConsensus(quotes) });
    }
    const key = r.fixture.id;
    if (!inflight.has(key)) inflight.set(key, analyzeResolved(r.fixture, t).finally(() => inflight.delete(key)));
    return inflight.get(key);
  }

  return { analyze };
}

module.exports = { createOnDemandAnalyzer, parseMatchQuery, resolveMatch, EVENT_MARKETS, USAGE };

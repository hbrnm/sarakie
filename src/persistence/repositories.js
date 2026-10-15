'use strict';

const crypto = require('node:crypto');
const { unwrap } = require('./supabase');

const CHUNK = 500;

function chunks(rows, size = CHUNK) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Data-access layer. Every write is idempotent or append-only:
 * - reference data and fixtures are upserted on their natural keys;
 * - odds snapshots are only inserted (the database rejects updates/deletes);
 * - closing odds of a provider event are inserted once (re-runs skip existing events).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ now?: () => Date, uuid?: () => string }} [options]
 */
function createRepositories(db, { now = () => new Date(), uuid = () => crypto.randomUUID() } = {}) {
  async function upsertProviderCompetitions(rows) {
    if (!rows.length) return;
    const payload = rows.map((r) => ({
      source_provider: r.sourceProvider,
      provider_competition_id: r.providerCompetitionId,
      competition_code: r.competitionCode,
      provider_name: r.providerName,
      current_season: r.currentSeason ?? null,
      discovered_at: now().toISOString(),
    }));
    unwrap(await db.from('provider_competition_map').upsert(payload, { onConflict: 'source_provider,provider_competition_id' }), 'upsert provider competitions');
  }

  /** provider team refs → team ids for one provider. */
  async function getTeamIds(sourceProvider, refs) {
    const map = new Map();
    for (const part of chunks([...new Set(refs)])) {
      const rows = unwrap(
        await db.from('provider_team_map').select('provider_team_ref, team_id').eq('source_provider', sourceProvider).in('provider_team_ref', part),
        'read provider team map',
      );
      for (const r of rows) map.set(r.provider_team_ref, r.team_id);
    }
    return map;
  }

  /**
   * Ensures every team of the primary (fixtures) provider has a canonical team.
   * @param {string} sourceProvider
   * @param {{ providerTeamId: string, name: string }[]} teams
   * @returns {Promise<Map<string, string>>} providerTeamId → team id
   */
  async function ensurePrimaryTeams(sourceProvider, teams) {
    const unique = [...new Map(teams.map((t) => [t.providerTeamId, t])).values()];
    const existing = await getTeamIds(sourceProvider, unique.map((t) => t.providerTeamId));
    const missing = unique.filter((t) => !existing.has(t.providerTeamId));
    if (missing.length) {
      const created = missing.map((t) => ({ id: uuid(), name: t.name, ref: t.providerTeamId }));
      unwrap(await db.from('teams').insert(created.map(({ id, name }) => ({ id, name }))), 'insert teams');
      unwrap(
        await db.from('provider_team_map').insert(
          created.map((c) => ({ source_provider: sourceProvider, provider_team_ref: c.ref, team_id: c.id, provider_name: c.name, match_method: 'primary' })),
        ),
        'insert provider team map',
      );
      for (const c of created) existing.set(c.ref, c.id);
    }
    return existing;
  }

  /** Records how a secondary provider's team name maps to a canonical team. */
  async function upsertSecondaryTeamMap(sourceProvider, entries) {
    if (!entries.length) return;
    const payload = entries.map((e) => ({
      source_provider: sourceProvider,
      provider_team_ref: e.providerName,
      team_id: e.teamId,
      provider_name: e.providerName,
      match_method: e.method,
    }));
    unwrap(await db.from('provider_team_map').upsert(payload, { onConflict: 'source_provider,provider_team_ref' }), 'upsert secondary team map');
  }

  /**
   * Upserts fixtures (status and score are mutable).
   * @param {import('../domain/types').Fixture[]} fixtures
   * @param {Map<string, string>} teamIds providerTeamId → team id
   * @returns {Promise<{ saved: Map<string, string>, skipped: number }>} providerFixtureId → fixture id
   */
  async function upsertFixtures(fixtures, teamIds) {
    const saved = new Map();
    let skipped = 0;
    const rows = [];
    for (const f of fixtures) {
      const home = teamIds.get(f.home.providerTeamId);
      const away = teamIds.get(f.away.providerTeamId);
      if (!home || !away) {
        skipped += 1;
        continue;
      }
      rows.push({
        competition_code: f.competitionCode,
        season: f.season,
        home_team_id: home,
        away_team_id: away,
        kickoff_utc: f.kickoffUtc,
        status: f.status,
        home_goals: f.homeGoals,
        away_goals: f.awayGoals,
        matchday: f.matchday ?? null,
        stage: f.stage ?? null,
        source_provider: f.sourceProvider,
        provider_fixture_id: f.providerFixtureId,
        updated_at: now().toISOString(),
      });
    }
    for (const part of chunks(rows)) {
      const data = unwrap(
        await db.from('fixtures').upsert(part, { onConflict: 'source_provider,provider_fixture_id' }).select('id, provider_fixture_id'),
        'upsert fixtures',
      );
      for (const r of data) saved.set(r.provider_fixture_id, r.id);
    }
    return { saved, skipped };
  }

  async function ensureBookmakers(sourceProvider, quotes) {
    const unique = [...new Map(quotes.map((q) => [q.bookmakerKey, q.bookmakerName])).entries()];
    if (!unique.length) return new Map();
    const data = unwrap(
      await db
        .from('bookmakers')
        .upsert(unique.map(([key, name]) => ({ source_provider: sourceProvider, provider_bookmaker_key: key, name })), { onConflict: 'source_provider,provider_bookmaker_key' })
        .select('id, provider_bookmaker_key'),
      'upsert bookmakers',
    );
    return new Map(data.map((r) => [r.provider_bookmaker_key, r.id]));
  }

  /** Provider event ids that already have snapshots (used to keep closing-odds imports idempotent). */
  async function eventsWithSnapshots(sourceProvider, eventIds) {
    const found = new Set();
    // Small chunks: each event has ~20 snapshot rows and PostgREST caps responses at 1000 rows.
    for (const part of chunks([...new Set(eventIds)], 40)) {
      const rows = unwrap(
        await db.from('odds_snapshots').select('provider_event_id').eq('source_provider', sourceProvider).in('provider_event_id', part),
        'read existing snapshots',
      );
      for (const r of rows) found.add(r.provider_event_id);
    }
    return found;
  }

  /**
   * Inserts odds snapshots (append-only).
   * @param {import('../domain/types').OddsQuote[]} quotes all from one provider
   * @param {{ fixtureIdByEvent?: Map<string, string>, skipExistingEvents?: boolean }} [options]
   */
  async function insertOddsSnapshots(quotes, { fixtureIdByEvent = new Map(), skipExistingEvents = false } = {}) {
    if (!quotes.length) return { inserted: 0, skippedEvents: 0, batchId: null };
    const sourceProvider = quotes[0].sourceProvider;
    if (quotes.some((q) => q.sourceProvider !== sourceProvider)) throw new Error('insertOddsSnapshots: mixed providers');
    let toInsert = quotes;
    let skippedEvents = 0;
    if (skipExistingEvents) {
      const existing = await eventsWithSnapshots(sourceProvider, quotes.map((q) => q.providerEventId));
      skippedEvents = existing.size;
      toInsert = quotes.filter((q) => !existing.has(q.providerEventId));
    }
    const bookmakerIds = await ensureBookmakers(sourceProvider, toInsert);
    const batchId = uuid();
    const rows = toInsert.map((q) => ({
      fixture_id: fixtureIdByEvent.get(q.providerEventId) ?? null,
      source_provider: q.sourceProvider,
      provider_event_id: q.providerEventId,
      bookmaker_id: bookmakerIds.get(q.bookmakerKey),
      market_code: q.marketCode,
      selection_code: q.selectionCode,
      line: q.line,
      decimal_odds: q.decimalOdds,
      kind: q.kind,
      source_timestamp: q.sourceTimestamp,
      captured_at: q.capturedAt,
      capture_batch_id: batchId,
    }));
    for (const part of chunks(rows)) unwrap(await db.from('odds_snapshots').insert(part), 'insert odds snapshots');
    return { inserted: rows.length, skippedEvents, batchId };
  }

  async function linkOddsEvents(sourceProvider, links) {
    if (!links.length) return;
    unwrap(
      await db.from('odds_event_links').upsert(
        links.map((l) => ({ source_provider: sourceProvider, provider_event_id: l.providerEventId, fixture_id: l.fixtureId })),
        { onConflict: 'source_provider,provider_event_id' },
      ),
      'upsert odds event links',
    );
  }

  async function upsertOddsEvents(sourceProvider, events) {
    if (!events.length) return;
    const t = now().toISOString();
    const rows = [...new Map(events.map((e) => [e.providerEventId, e])).values()].map((e) => ({
      source_provider: sourceProvider,
      provider_event_id: e.providerEventId,
      competition_code: e.competitionCode,
      kickoff_utc: e.kickoffUtc,
      home_team_name: e.homeTeamName,
      away_team_name: e.awayTeamName,
      last_seen_at: t,
    }));
    for (const part of chunks(rows)) {
      unwrap(await db.from('odds_events').upsert(part, { onConflict: 'source_provider,provider_event_id' }), 'upsert odds events');
    }
  }

  /** Keeps display names current: { id, name, shortName }[] keyed by canonical team id. */
  async function updateTeamNames(entries) {
    const rows = [...new Map(entries.filter((e) => e.id).map((e) => [e.id, e])).values()].map((e) => ({ id: e.id, name: e.name, short_name: e.shortName || null }));
    for (const part of chunks(rows)) unwrap(await db.from('teams').upsert(part, { onConflict: 'id' }), 'update team names');
  }

  /** Request log entries from the HTTP client's onRequest hook (path only, never query strings). */
  async function insertRequestLog(entries) {
    const rows = entries.map((e) => ({
      source_provider: e.provider,
      endpoint: String(e.endpoint).split('?')[0],
      requested_at: (e.at || now()).toISOString(),
      http_status: e.status,
      duration_ms: e.durationMs ?? null,
      attempt: e.attempt ?? 0,
      credits_last: e.creditsLast ?? null,
      credits_remaining: e.creditsRemaining ?? null,
    }));
    for (const part of chunks(rows)) unwrap(await db.from('provider_request_log').insert(part), 'insert request log');
  }

  return {
    upsertProviderCompetitions,
    getTeamIds,
    ensurePrimaryTeams,
    upsertSecondaryTeamMap,
    upsertFixtures,
    ensureBookmakers,
    insertOddsSnapshots,
    linkOddsEvents,
    upsertOddsEvents,
    updateTeamNames,
    insertRequestLog,
  };
}

/**
 * Credit store for the odds budget backed by the append-only `odds_credit_ledger`.
 * Same interface as createMemoryCreditStore().
 */
function createSupabaseCreditStore(db) {
  return {
    async get(month) {
      const rows = unwrap(
        await db.from('odds_credit_ledger').select('purpose, credits, provider_remaining, recorded_at').eq('month', month).order('recorded_at', { ascending: true }),
        'read credit ledger',
      );
      const out = { scanner: 0, on_demand: 0, other: 0, providerRemaining: null };
      for (const r of rows) {
        out[r.purpose] += r.credits;
        if (r.provider_remaining !== null) out.providerRemaining = r.provider_remaining;
      }
      return out;
    },
    async add(month, purpose, credits, providerRemaining) {
      unwrap(
        await db.from('odds_credit_ledger').insert({ month, purpose, credits, provider_remaining: providerRemaining ?? null }),
        'insert credit ledger',
      );
    },
  };
}

module.exports = { createRepositories, createSupabaseCreditStore };

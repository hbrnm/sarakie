'use strict';

const { unwrap } = require('./supabase');

const PAGE = 1000; // PostgREST default response cap
const ODDS = 'the_odds_api';

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Data access for the analysis pipeline (Phase 5): reads fixtures, history and odds, and
 * writes runs, append-only predictions and explanations. Maps rows to domain shapes so
 * the pipeline and the domain code never see table structures.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createAnalysisStore(db) {
  const teamNames = new Map();
  let bookmakers = null;

  function toFixture(r) {
    return {
      id: r.id,
      competitionCode: r.competition_code,
      season: r.season,
      kickoffUtc: new Date(r.kickoff_utc).toISOString(),
      status: r.status,
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      homeGoals: r.home_goals,
      awayGoals: r.away_goals,
    };
  }
  const FIXTURE_COLUMNS = 'id, competition_code, season, kickoff_utc, status, home_team_id, away_team_id, home_goals, away_goals';

  async function getFixture(id) {
    const rows = unwrap(await db.from('fixtures').select(FIXTURE_COLUMNS).eq('id', id), 'read fixture');
    return rows.length ? toFixture(rows[0]) : null;
  }

  /** Scheduled fixtures kicking off in [from, to), oldest first. */
  async function upcomingFixtures({ from, to, competitionCodes }) {
    const rows = unwrap(
      await db
        .from('fixtures')
        .select(FIXTURE_COLUMNS)
        .gte('kickoff_utc', from.toISOString())
        .lt('kickoff_utc', to.toISOString())
        .eq('status', 'SCHEDULED')
        .in('competition_code', competitionCodes)
        .order('kickoff_utc', { ascending: true }),
      'read upcoming fixtures',
    );
    return rows.map(toFixture);
  }

  /**
   * The most recent finished league matches strictly before `before` (one page, about 2.5
   * seasons; the model uses at most 380 league and 38 team matches). Leakage is guarded
   * again inside estimate().
   */
  async function loadHistory({ competitionCode, before }) {
    const rows = unwrap(
      await db
        .from('fixtures')
        .select(FIXTURE_COLUMNS)
        .eq('competition_code', competitionCode)
        .eq('status', 'FINISHED')
        .lt('kickoff_utc', before.toISOString())
        .order('kickoff_utc', { ascending: false })
        .range(0, PAGE - 1),
      'read history',
    );
    return rows.map(toFixture);
  }

  async function teamName(id) {
    if (!teamNames.has(id)) {
      const rows = unwrap(await db.from('teams').select('id, name, short_name').eq('id', id), 'read team');
      teamNames.set(id, rows.length ? rows[0].short_name || rows[0].name : '?');
    }
    return teamNames.get(id);
  }

  async function bookmakerById() {
    if (!bookmakers) {
      const rows = unwrap(await db.from('bookmakers').select('id, provider_bookmaker_key, name'), 'read bookmakers');
      bookmakers = new Map(rows.map((r) => [r.id, { key: r.provider_bookmaker_key, name: r.name }]));
    }
    return bookmakers;
  }

  const QUOTE_COLUMNS = 'id, provider_event_id, bookmaker_id, market_code, selection_code, line, decimal_odds, kind, source_timestamp, captured_at, source_provider';

  /** All pre-match snapshot rows matching `filter`, captured at or after `since` (paged). */
  async function snapshotRows(filter, since, what) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = unwrap(
        await filter(db.from('odds_snapshots').select(QUOTE_COLUMNS).eq('kind', 'pre_match').gte('captured_at', since.toISOString()))
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1),
        what,
      );
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async function toQuotes(rows) {
    let books = await bookmakerById();
    if (rows.some((r) => !books.has(r.bookmaker_id))) {
      bookmakers = null; // new bookmakers were added since the cache was filled
      books = await bookmakerById();
    }
    return rows.map((r) => {
      const b = books.get(r.bookmaker_id) || { key: `id:${r.bookmaker_id}`, name: `#${r.bookmaker_id}` };
      return {
        snapshotId: r.id,
        sourceProvider: r.source_provider,
        providerEventId: r.provider_event_id,
        bookmakerKey: b.key,
        bookmakerName: b.name,
        marketCode: r.market_code,
        selectionCode: r.selection_code,
        line: num(r.line),
        decimalOdds: num(r.decimal_odds),
        kind: r.kind,
        sourceTimestamp: r.source_timestamp ? new Date(r.source_timestamp).toISOString() : null,
        capturedAt: new Date(r.captured_at).toISOString(),
      };
    });
  }

  /** Provider event ids linked to a fixture (odds_event_links). */
  async function linkedEventIds(fixtureId) {
    const links = unwrap(
      await db.from('odds_event_links').select('provider_event_id').eq('source_provider', ODDS).eq('fixture_id', fixtureId),
      'read odds event links',
    );
    return links.map((l) => l.provider_event_id);
  }

  /**
   * Pre-match quotes for a fixture captured at or after `since`. Snapshots are found by their
   * own fixture_id and through odds_event_links (events linked after capture).
   * @returns {Promise<(import('../domain/types').OddsQuote & { snapshotId: number })[]>}
   */
  async function loadQuotes({ fixtureId, since }) {
    const byId = new Map();
    for (const r of await snapshotRows((q) => q.eq('fixture_id', fixtureId), since, 'read fixture odds')) byId.set(r.id, r);
    const eventIds = await linkedEventIds(fixtureId);
    if (eventIds.length) {
      for (const r of await snapshotRows((q) => q.eq('source_provider', ODDS).in('provider_event_id', eventIds), since, 'read linked odds')) byId.set(r.id, r);
    }
    return toQuotes([...byId.values()]);
  }

  /** Pre-match quotes of provider events (UCL/UEL market view, D-19). */
  async function loadEventQuotes({ eventIds, since }) {
    if (!eventIds.length) return [];
    return toQuotes(await snapshotRows((q) => q.eq('source_provider', ODDS).in('provider_event_id', eventIds), since, 'read event odds'));
  }

  /** Odds events (provider metadata) kicking off in [from, to) for the given competitions. */
  async function upcomingOddsEvents({ from, to, competitionCodes }) {
    const rows = unwrap(
      await db
        .from('odds_events')
        .select('provider_event_id, competition_code, kickoff_utc, home_team_name, away_team_name')
        .eq('source_provider', ODDS)
        .gte('kickoff_utc', from.toISOString())
        .lt('kickoff_utc', to.toISOString())
        .in('competition_code', competitionCodes)
        .order('kickoff_utc', { ascending: true }),
      'read upcoming odds events',
    );
    return rows.map((r) => ({
      providerEventId: r.provider_event_id,
      competitionCode: r.competition_code,
      kickoffUtc: new Date(r.kickoff_utc).toISOString(),
      homeTeamName: r.home_team_name,
      awayTeamName: r.away_team_name,
    }));
  }

  /** Every known name of the given teams (canonical, short, provider names) for matching user input. */
  async function teamAliases(teamIds) {
    const out = new Map(teamIds.map((id) => [id, []]));
    if (!teamIds.length) return out;
    for (const t of unwrap(await db.from('teams').select('id, name, short_name').in('id', teamIds), 'read teams')) {
      out.get(t.id).push(t.name, t.short_name);
      teamNames.set(t.id, t.short_name || t.name);
    }
    for (const m of unwrap(await db.from('provider_team_map').select('team_id, provider_name').in('team_id', teamIds), 'read team names')) {
      out.get(m.team_id).push(m.provider_name);
    }
    for (const [id, names] of out) out.set(id, [...new Set(names.filter(Boolean))]);
    return out;
  }

  /** Registers a model version once (immutable); returns its id. */
  async function ensureModelVersion({ modelFamily, modelVersion, config, configHash }) {
    const find = async () => unwrap(await db.from('model_versions').select('id').eq('config_hash', configHash), 'read model version');
    let rows = await find();
    if (!rows.length) {
      unwrap(
        await db.from('model_versions').upsert(
          { model_family: modelFamily, model_version: modelVersion, config, config_hash: configHash },
          { onConflict: 'config_hash', ignoreDuplicates: true },
        ),
        'insert model version',
      );
      rows = await find();
    }
    return rows[0].id;
  }

  async function startRun({ trigger, scanDate = null, asOf, modelVersionId, riskVersion, riskConfigHash }) {
    const rows = unwrap(
      await db
        .from('analysis_runs')
        .insert({
          trigger,
          scan_date: scanDate,
          as_of: asOf.toISOString(),
          model_version_id: modelVersionId,
          risk_version: riskVersion,
          risk_config_hash: riskConfigHash,
        })
        .select('id'),
      'start analysis run',
    );
    return rows[0].id;
  }

  async function finishRun(id, { status, finishedAt, counts = {}, errorSummary = null }) {
    unwrap(
      await db
        .from('analysis_runs')
        .update({
          status,
          finished_at: finishedAt.toISOString(),
          fixtures_considered: counts.considered ?? 0,
          fixtures_analyzed: counts.analyzed ?? 0,
          fixtures_recorded: counts.recorded ?? 0,
          credits_used: counts.credits ?? 0,
          error_summary: errorSummary ? String(errorSummary).slice(0, 1000) : null,
        })
        .eq('id', id),
      'finish analysis run',
    );
  }

  /** input_hash of the most recent prediction for a fixture, or null. */
  async function lastInputHash(fixtureId) {
    const rows = unwrap(
      await db.from('predictions').select('input_hash').eq('fixture_id', fixtureId).order('id', { ascending: false }).range(0, 0),
      'read last prediction',
    );
    return rows.length ? rows[0].input_hash : null;
  }

  async function insertPredictions(rows) {
    if (rows.length) unwrap(await db.from('predictions').insert(rows), 'insert predictions');
  }

  async function insertExplanation(row) {
    unwrap(await db.from('explanations').insert(row), 'insert explanation');
  }

  async function getDigest(scanDate) {
    const rows = unwrap(await db.from('scan_digests').select('scan_date, analysis_run_id, text, created_at').eq('scan_date', scanDate), 'read digest');
    return rows[0] || null;
  }

  /**
   * Stores the day's digest. The primary key on scan_date makes this the claim: only the
   * first run of a day stores (and then sends) a digest.
   * @returns {Promise<boolean>} false if a digest for the day already exists
   */
  async function insertDigest({ scanDate, runId, text }) {
    try {
      unwrap(await db.from('scan_digests').insert({ scan_date: scanDate, analysis_run_id: runId, text }), 'insert digest');
      return true;
    } catch (err) {
      if (err.dbCode === '23505') return false;
      throw err;
    }
  }

  /** Finished scanner runs (OK or PARTIAL) for a scan date. */
  async function successfulScans(scanDate) {
    return unwrap(
      await db.from('analysis_runs').select('id, status, finished_at').eq('trigger', 'scanner').eq('scan_date', scanDate).in('status', ['OK', 'PARTIAL']),
      'read scanner runs',
    );
  }

  /** Predictions of final fixtures without an outcome (view unsettled_predictions), oldest first. */
  async function unsettledPredictions() {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = unwrap(
        await db.from('unsettled_predictions').select('prediction_id, market_code, selection_code, line, decimal_odds, fixture_status, home_goals, away_goals').order('prediction_id', { ascending: true }).range(from, from + PAGE - 1),
        'read unsettled predictions',
      );
      out.push(...rows.map((r) => ({
        predictionId: r.prediction_id,
        marketCode: r.market_code,
        selectionCode: r.selection_code,
        line: num(r.line),
        decimalOdds: num(r.decimal_odds),
        fixture: { status: r.fixture_status, homeGoals: r.home_goals, awayGoals: r.away_goals },
      })));
      if (rows.length < PAGE) return out;
    }
  }

  /** Inserts outcomes; one already settled by a concurrent run is skipped (ON CONFLICT DO NOTHING). */
  async function insertOutcomes(rows) {
    for (let i = 0; i < rows.length; i += PAGE) {
      unwrap(await db.from('prediction_outcomes').upsert(rows.slice(i, i + PAGE), { onConflict: 'prediction_id', ignoreDuplicates: true }), 'insert outcomes');
    }
  }

  return {
    unsettledPredictions,
    insertOutcomes,
    getDigest,
    insertDigest,
    successfulScans,
    getFixture,
    upcomingFixtures,
    loadHistory,
    teamName,
    loadQuotes,
    loadEventQuotes,
    linkedEventIds,
    upcomingOddsEvents,
    teamAliases,
    ensureModelVersion,
    startRun,
    finishRun,
    lastInputHash,
    insertPredictions,
    insertExplanation,
  };
}

module.exports = { createAnalysisStore };

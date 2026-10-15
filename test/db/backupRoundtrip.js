'use strict';

/**
 * Backup round-trip check (CI `db` job): rows shaped like PostgREST output — UUIDs,
 * arrays, jsonb, NULL vs '', quotes, commas, newlines — are exported with exportTables()
 * and restored with restoreSql() into a database where only the migrations were applied.
 *   node test/db/backupRoundtrip.js <dir>   → writes the export and prints the restore script
 */

const { createFakeDb } = require('../persistence/fakeDb');
const { exportTables, restoreSql } = require('../../src/jobs/backup');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function main() {
  const dir = process.argv[2];
  const db = createFakeDb();
  const t = (name, rows) => db.table(name).push(...rows);
  t('competitions', [
    ['EPL', 'Premier League', 'England', 'domestic', true], ['LALIGA', 'La Liga', 'Spain', 'domestic', true],
    ['SERIEA', 'Serie A', 'Italy', 'domestic', true], ['BUNDESLIGA', 'Bundesliga', 'Germany', 'domestic', true],
    ['LIGUE1', 'Ligue 1', 'France', 'domestic', true], ['UCL', 'UEFA Champions League', 'Europe', 'uefa', false],
    ['UEL', 'UEFA Europa League', 'Europe', 'uefa', false],
  ].map(([code, name, country, type, model_applicable]) => ({ code, name, country, type, model_applicable })));
  t('provider_competition_map', [{ source_provider: 'football_data_org', provider_competition_id: '2021', competition_code: 'EPL', provider_name: 'Premier League', current_season: 2026, discovered_at: '2026-10-15T07:17:00+00:00' }]);
  t('teams', [
    { id: U(1), name: 'Brighton & Hove Albion FC', country: null, created_at: '2026-10-15T07:17:00+00:00', short_name: 'Brighton' },
    { id: U(2), name: 'Hapoel Be\'er Sheva "B", test', country: 'Israel', created_at: '2026-10-15T07:17:00+00:00', short_name: '' },
  ]);
  t('provider_team_map', [{ source_provider: 'the_odds_api', provider_team_ref: 'Brighton and Hove Albion', team_id: U(1), provider_name: 'Brighton and Hove Albion', match_method: 'alias', created_at: '2026-10-15T07:17:00+00:00' }]);
  t('fixtures', [{ id: U(10), competition_code: 'EPL', season: 2026, home_team_id: U(1), away_team_id: U(2), kickoff_utc: '2026-10-14T14:00:00+00:00', status: 'FINISHED', home_goals: 1, away_goals: 1, matchday: 8, stage: null, source_provider: 'football_data_org', provider_fixture_id: '999', created_at: '2026-10-01T00:00:00+00:00', updated_at: '2026-10-15T07:17:00+00:00' }]);
  t('bookmakers', [{ id: 3, source_provider: 'the_odds_api', provider_bookmaker_key: 'unibet_nl', name: 'Unibet (NL)' }]);
  t('odds_events', [{ source_provider: 'the_odds_api', provider_event_id: 'ev1', competition_code: 'EPL', kickoff_utc: '2026-10-14T14:00:00+00:00', home_team_name: 'Brighton', away_team_name: 'X', first_seen_at: '2026-10-13T07:17:00+00:00', last_seen_at: '2026-10-14T07:17:00+00:00' }]);
  t('odds_snapshots', [
    { id: 41, fixture_id: U(10), source_provider: 'the_odds_api', provider_event_id: 'ev1', bookmaker_id: 3, market_code: 'OU', selection_code: 'OVER', line: 2.5, decimal_odds: 1.95, kind: 'pre_match', source_timestamp: null, captured_at: '2026-10-14T07:17:00+00:00', capture_batch_id: U(20) },
    { id: 42, fixture_id: null, source_provider: 'the_odds_api', provider_event_id: 'ev1', bookmaker_id: 3, market_code: '1X2', selection_code: 'HOME', line: null, decimal_odds: 2.1, kind: 'pre_match', source_timestamp: '2026-10-14T07:00:00+00:00', captured_at: '2026-10-14T07:17:00+00:00', capture_batch_id: U(20) },
  ]);
  t('odds_event_links', [{ source_provider: 'the_odds_api', provider_event_id: 'ev1', fixture_id: U(10), linked_at: '2026-10-14T07:17:00+00:00' }]);
  t('provider_request_log', [{ id: 7, source_provider: 'the_odds_api', endpoint: '/v4/sports/soccer_epl/odds', requested_at: '2026-10-14T07:17:00+00:00', http_status: 200, duration_ms: 300, attempt: 0, credits_last: 2, credits_remaining: 447 }]);
  t('odds_credit_ledger', [{ id: 5, month: '2026-10', purpose: 'scanner', credits: 2, provider_remaining: 447, recorded_at: '2026-10-14T07:17:00+00:00' }]);
  t('model_versions', [{ id: 1, model_family: 'poisson-independent', model_version: '1.0.0', config: { nTeam: 38, ouLines: [1.5, 2.5, 3.5], note: 'a "quoted", comma' }, config_hash: 'a'.repeat(64), created_at: '2026-10-14T07:17:00+00:00', notes: null }]);
  t('analysis_runs', [{ id: U(30), trigger: 'scanner', scan_date: '2026-10-14', started_at: '2026-10-14T07:18:00+00:00', finished_at: '2026-10-14T07:19:00+00:00', as_of: '2026-10-14T07:18:00+00:00', model_version_id: 1, risk_version: '1.1.0', risk_config_hash: 'b'.repeat(64), fixtures_considered: 1, fixtures_analyzed: 1, fixtures_recorded: 1, credits_used: 0, status: 'OK', error_summary: null }]);
  t('predictions', [
    { id: 100, analysis_run_id: U(30), fixture_id: U(10), model_version_id: 1, risk_version: '1.1.0', risk_config_hash: 'b'.repeat(64), mode: 'scanner', input_hash: 'c'.repeat(64), as_of: '2026-10-14T07:18:00+00:00', data_cutoff_utc: '2026-10-10T14:00:00+00:00', created_at: '2026-10-14T07:18:30+00:00', market_code: 'OU', selection_code: 'OVER', line: 2.5, lambda_home: 1.61, lambda_away: 1.12, p_model: 0.55, p_push: null, p_loss: null, fair_odds: 1.818, odds_snapshot_id: 41, bookmaker_key: 'unibet_nl', decimal_odds: 1.95, p_raw: 0.5128, p_devig: 0.49, overround: 0.04, ev: 0.0725, bookmaker_count: 12, status: 'QUALIFIED', reason_codes: [], notes: ['PRICE_OUTLIER_EXCLUDED'], diagnostics: { home: { n: 38 }, estimateReasons: [] } },
    { id: 101, analysis_run_id: U(30), fixture_id: U(10), model_version_id: 1, risk_version: '1.1.0', risk_config_hash: 'b'.repeat(64), mode: 'scanner', input_hash: 'c'.repeat(64), as_of: '2026-10-14T07:18:00+00:00', data_cutoff_utc: null, created_at: '2026-10-14T07:18:30+00:00', market_code: 'BTTS', selection_code: 'YES', line: null, lambda_home: 1.61, lambda_away: 1.12, p_model: 0.5, p_push: null, p_loss: null, fair_odds: 2, odds_snapshot_id: null, bookmaker_key: null, decimal_odds: null, p_raw: null, p_devig: null, overround: null, ev: null, bookmaker_count: null, status: 'INSUFFICIENT_DATA', reason_codes: ['ODDS_NOT_FETCHED', 'TEAM "X"'], notes: [], diagnostics: {} },
  ]);
  t('prediction_outcomes', [
    { prediction_id: 100, settled_at: '2026-10-15T07:20:00+00:00', result: 'LOSS', home_goals: 1, away_goals: 1, closing_odds_snapshot_id: null, profit_per_unit: -1 },
    { prediction_id: 101, settled_at: '2026-10-15T07:20:00+00:00', result: 'VOID', home_goals: 1, away_goals: 1, closing_odds_snapshot_id: null, profit_per_unit: null },
  ]);
  t('explanations', [{ id: 9, analysis_run_id: U(30), fixture_id: U(10), generator: 'template', model_id: null, validated: false, rejection_reason: 'GEMINI_ERROR', text: 'Linia 1, cu virgulă\n„Linia 2” cu "ghilimele"', created_at: '2026-10-14T07:18:30+00:00' }]);
  t('scan_digests', [{ scan_date: '2026-10-14', analysis_run_id: U(30), text: 'FVIS — scanare\n• a, b', created_at: '2026-10-14T07:19:00+00:00' }]);
  t('line_candidates', [
    { id: 200, analysis_run_id: U(30), fixture_id: U(10), kickoff_utc: '2026-10-14T14:00:00+00:00', rule_version: '1.0.0', rule_config_hash: 'd'.repeat(64), scope: 'playable', market_code: '1X2', selection_code: 'HOME', pin_snapshot_id: 42, pin_odds: 2.0, p_pin: 0.4865, pin_overround: 0.0278, pin_captured_at: '2026-10-14T07:17:00+00:00', price_snapshot_id: 42, bookmaker_key: 'unibet_nl', price: 2.1, median_price: 1.95, n_prices: 12, edge: 0.0216, status: 'WATCHLIST', reason_codes: ['EDGE_BELOW_MIN'], created_at: '2026-10-14T07:18:30+00:00' },
    { id: 201, analysis_run_id: U(30), fixture_id: U(10), kickoff_utc: '2026-10-14T14:00:00+00:00', rule_version: '1.0.0', rule_config_hash: 'd'.repeat(64), scope: 'all', market_code: '1X2', selection_code: 'AWAY', pin_snapshot_id: null, pin_odds: null, p_pin: null, pin_overround: null, pin_captured_at: null, price_snapshot_id: null, bookmaker_key: null, price: null, median_price: null, n_prices: 0, edge: null, status: 'INSUFFICIENT_DATA', reason_codes: ['NO_SHARP_REFERENCE', 'NO_PRICE'], created_at: '2026-10-14T07:18:30+00:00' },
  ]);
  t('line_candidate_outcomes', [{ candidate_id: 200, settled_at: '2026-10-15T07:20:00+00:00', result: 'LOSS', home_goals: 1, away_goals: 1, close_snapshot_id: null, pin_close_odds: 2.05, p_pin_close: 0.47, clv: 0.0244, close_ev: -0.013, profit_per_unit: -1 }]);

  const manifest = await exportTables({ db, outDir: dir });
  let sql = restoreSql(manifest, dir);
  // Value checks beyond row counts: arrays, jsonb, NULL vs '', multi-line text survive.
  sql = sql.replace('commit;', () => [
    "do $$ begin if (select short_name from public.teams where id = '" + U(2) + "') <> '' then raise exception 'empty string became NULL'; end if; end $$;",
    "do $$ begin if (select country from public.teams where id = '" + U(1) + "') is not null then raise exception 'NULL became a value'; end if; end $$;",
    "do $$ begin if (select reason_codes from public.predictions where id = 101) <> array['ODDS_NOT_FETCHED', 'TEAM \"X\"'] then raise exception 'text[] round-trip failed'; end if; end $$;",
    "do $$ begin if (select config->>'note' from public.model_versions where id = 1) <> 'a \"quoted\", comma' then raise exception 'jsonb round-trip failed'; end if; end $$;",
    "do $$ begin if (select text from public.explanations where id = 9) not like '%\n„Linia 2” cu \"ghilimele\"' then raise exception 'multi-line text round-trip failed'; end if; end $$;",
    "do $$ begin if (select nextval(pg_get_serial_sequence('public.predictions', 'id'))) <> 102 then raise exception 'identity sequence not reset'; end if; end $$;",
    "do $$ begin if (select nextval(pg_get_serial_sequence('public.line_candidates', 'id'))) <> 202 then raise exception 'line_candidates sequence not reset'; end if; end $$;",
    "do $$ begin if (select reason_codes from public.line_candidates where id = 201) <> array['NO_SHARP_REFERENCE', 'NO_PRICE'] then raise exception 'line reason codes round-trip failed'; end if; end $$;",
    'commit;',
  ].join('\n'));
  process.stdout.write(sql);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

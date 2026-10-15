-- Assertions for migration 20261015000003 (Phase 5.1). Runs inside a transaction that is
-- rolled back, so it does not interfere with other test files.
begin;

create or replace function pg_temp.expect_error(sql text, label text, state text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label;
exception
  when others then
    if sqlerrm like 'EXPECTED FAILURE DID NOT HAPPEN%' then raise; end if;
    if sqlstate <> state then
      raise exception 'WRONG ERROR for %: expected %, got % (%)', label, state, sqlstate, sqlerrm;
    end if;
end;
$$;

-- seed
insert into public.teams (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Team A'),
  ('00000000-0000-0000-0000-0000000000a2', 'Team B');
insert into public.fixtures (id, competition_code, season, home_team_id, away_team_id, kickoff_utc, status, source_provider, provider_fixture_id)
values ('00000000-0000-0000-0000-0000000000e1', 'EPL', 2026, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
        '2026-10-18T14:00:00Z', 'SCHEDULED', 'test_provider', 'p5-1');
insert into public.model_versions (model_family, model_version, config, config_hash)
values ('poisson-independent', '1.0.0', '{}', repeat('a', 64));
insert into public.analysis_runs (id, trigger, scan_date, as_of, model_version_id, risk_version, risk_config_hash)
values ('00000000-0000-0000-0000-0000000000b1', 'scanner', current_date, now() - interval '1 hour',
        (select id from public.model_versions where config_hash = repeat('a', 64)), '1.0.0', repeat('b', 64));

insert into public.predictions (analysis_run_id, fixture_id, model_version_id, risk_version, risk_config_hash, mode, input_hash, as_of,
  market_code, selection_code, line, p_model, decimal_odds, ev, status, reason_codes)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', (select id from public.model_versions limit 1), '1.0.0', repeat('b', 64),
   'scanner', repeat('c', 64), now() - interval '1 hour', '1X2', 'HOME', null, 0.5, 2.2, 0.1, 'QUALIFIED', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', (select id from public.model_versions limit 1), '1.0.0', repeat('b', 64),
   'scanner', repeat('c', 64), now() - interval '1 hour', 'BTTS', 'YES', null, null, null, null, 'INSUFFICIENT_DATA', '{ODDS_NOT_FETCHED}');

insert into public.prediction_outcomes (prediction_id, result, home_goals, away_goals, profit_per_unit)
values ((select id from public.predictions where market_code = '1X2'), 'WIN', 2, 0, 1.2);
insert into public.explanations (analysis_run_id, fixture_id, generator, validated, text)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'template', false, 'text');
insert into public.scan_digests (scan_date, analysis_run_id, text) values (current_date, '00000000-0000-0000-0000-0000000000b1', 'digest');

-- append-only tables
select pg_temp.expect_error('update public.predictions set ev = 0.5', 'predictions update', '42501');
select pg_temp.expect_error('delete from public.predictions', 'predictions delete', '42501');
select pg_temp.expect_error('truncate public.predictions cascade', 'predictions truncate', '42501');
select pg_temp.expect_error('update public.prediction_outcomes set result = ''LOSS''', 'outcome update', '42501');
select pg_temp.expect_error('delete from public.prediction_outcomes', 'outcome delete', '42501');
select pg_temp.expect_error('update public.model_versions set notes = ''x''', 'model version update', '42501');
select pg_temp.expect_error('delete from public.model_versions', 'model version delete', '42501');
select pg_temp.expect_error('update public.explanations set text = ''x''', 'explanation update', '42501');
select pg_temp.expect_error('update public.scan_digests set text = ''x''', 'digest update', '42501');
select pg_temp.expect_error('delete from public.scan_digests', 'digest delete', '42501');

-- one digest per day; one outcome per prediction; one row per run/fixture/selection
select pg_temp.expect_error($q$insert into public.scan_digests (scan_date, analysis_run_id, text) values (current_date, '00000000-0000-0000-0000-0000000000b1', 'again')$q$, 'duplicate digest', '23505');
select pg_temp.expect_error($q$insert into public.prediction_outcomes (prediction_id, result, profit_per_unit) values ((select id from public.predictions where market_code = '1X2'), 'LOSS', -1)$q$, 'second outcome', '23505');
select pg_temp.expect_error($q$insert into public.predictions (analysis_run_id, fixture_id, model_version_id, risk_version, risk_config_hash, mode, input_hash, as_of, market_code, selection_code, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, '1.0.0', repeat('b', 64), 'scanner', repeat('c', 64), now() - interval '1 hour', '1X2', 'HOME', 'INSUFFICIENT_DATA')$q$, 'duplicate selection in run', '23505');

-- integrity checks
select pg_temp.expect_error($q$insert into public.predictions (analysis_run_id, fixture_id, model_version_id, risk_version, risk_config_hash, mode, input_hash, as_of, market_code, selection_code, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, '1.0.0', repeat('b', 64), 'scanner', repeat('c', 64), now(), '1X2', 'DRAW', 'QUALIFIED')$q$, 'value status without odds/EV', '23514');
select pg_temp.expect_error($q$insert into public.predictions (analysis_run_id, fixture_id, model_version_id, risk_version, risk_config_hash, mode, input_hash, as_of, market_code, selection_code, p_model, decimal_odds, ev, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, '1.0.0', repeat('b', 64), 'scanner', repeat('c', 64), now(), '1X2', 'DRAW', 0.2, 3.0, -0.4, 'WATCHLIST')$q$, 'watchlist with negative EV', '23514');
select pg_temp.expect_error($q$insert into public.predictions (analysis_run_id, fixture_id, model_version_id, risk_version, risk_config_hash, mode, input_hash, as_of, market_code, selection_code, line, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, '1.0.0', repeat('b', 64), 'scanner', repeat('c', 64), now(), 'OU', 'OVER', 2.75, 'INSUFFICIENT_DATA')$q$, 'quarter line', '23514');
select pg_temp.expect_error($q$insert into public.predictions (analysis_run_id, fixture_id, model_version_id, risk_version, risk_config_hash, mode, input_hash, as_of, market_code, selection_code, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, '1.0.0', repeat('b', 64), 'scanner', repeat('c', 64), now() + interval '1 day', '1X2', 'AWAY', 'INSUFFICIENT_DATA')$q$, 'as_of in the future', '23514');
select pg_temp.expect_error($q$insert into public.prediction_outcomes (prediction_id, result, profit_per_unit) values ((select id from public.predictions where market_code = 'BTTS'), 'VOID', 0)$q$, 'void with profit', '23514');
select pg_temp.expect_error($q$insert into public.analysis_runs (trigger, as_of, risk_version, risk_config_hash) values ('scanner', now(), '1.0.0', repeat('b', 64))$q$, 'scanner run without scan_date', '23514');
select pg_temp.expect_error($q$insert into public.analysis_runs (trigger, as_of, risk_version, risk_config_hash, status) values ('on_demand', now(), '1.0.0', repeat('b', 64), 'OK')$q$, 'finished run without finished_at', '23514');

-- analysis runs stay mutable (status and counts are completed at the end of a run)
update public.analysis_runs set status = 'OK', finished_at = now(), fixtures_analyzed = 1 where id = '00000000-0000-0000-0000-0000000000b1';

select 'ALL PREDICTION ASSERTIONS PASSED' as result;
rollback;

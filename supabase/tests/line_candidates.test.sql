-- Assertions for migration 20261015000005 (Phase 6d). Runs inside a transaction that is
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
  ('00000000-0000-0000-0000-0000000006a1', 'Team A'),
  ('00000000-0000-0000-0000-0000000006a2', 'Team B');
insert into public.fixtures (id, competition_code, season, home_team_id, away_team_id, kickoff_utc, status, source_provider, provider_fixture_id)
values ('00000000-0000-0000-0000-0000000006e1', 'EPL', 2026, '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000006a2',
        '2026-10-18T14:00:00Z', 'SCHEDULED', 'test_provider', 'p6-1');
insert into public.analysis_runs (id, trigger, scan_date, as_of, risk_version, risk_config_hash)
values ('00000000-0000-0000-0000-0000000006b1', 'scanner', current_date - 100, now() - interval '1 hour', '1.2.0', repeat('b', 64));

-- Snapshot ids stay null here: inserting odds would consume identity values that other test files rely on.
insert into public.line_candidates (analysis_run_id, fixture_id, kickoff_utc, rule_version, rule_config_hash, scope, market_code, selection_code,
  pin_snapshot_id, pin_odds, p_pin, price_snapshot_id, bookmaker_key, price, median_price, n_prices, edge, status, reason_codes)
values
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', '2026-10-18T14:00:00Z', '1.0.0', repeat('d', 64), 'playable', '1X2', 'HOME',
   null, 2.0, 0.4865, null, 'unibet_nl', 2.15, 1.95, 8, 0.046, 'LINE_VALUE', '{}'),
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', '2026-10-18T14:00:00Z', '1.0.0', repeat('d', 64), 'all', '1X2', 'AWAY',
   null, null, null, null, null, null, null, 0, null, 'INSUFFICIENT_DATA', '{NO_SHARP_REFERENCE}');

-- append-only
select pg_temp.expect_error('update public.line_candidates set edge = 0.5', 'candidate update', '42501');
select pg_temp.expect_error('delete from public.line_candidates', 'candidate delete', '42501');
select pg_temp.expect_error('truncate public.line_candidates cascade', 'candidate truncate', '42501');

-- the same odds give the same row (nulls not distinct): re-runs insert nothing
select pg_temp.expect_error($q$insert into public.line_candidates (analysis_run_id, fixture_id, kickoff_utc, rule_version, rule_config_hash, scope, market_code, selection_code, n_prices, status)
  values ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', now(), '1.0.0', repeat('d', 64), 'all', '1X2', 'AWAY', 0, 'INSUFFICIENT_DATA')$q$, 'duplicate unpriced row', '23505');
insert into public.line_candidates (analysis_run_id, fixture_id, kickoff_utc, rule_version, rule_config_hash, scope, market_code, selection_code, n_prices, status)
values ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', now(), '1.0.0', repeat('d', 64), 'all', '1X2', 'AWAY', 0, 'INSUFFICIENT_DATA')
on conflict (fixture_id, selection_code, scope, pin_snapshot_id, price_snapshot_id) do nothing;
do $$ begin if (select count(*) from public.line_candidates where selection_code = 'AWAY') <> 1 then raise exception 'on conflict do nothing did not dedupe'; end if; end $$;

-- value statuses carry price, probability and a positive edge; only 1X2
select pg_temp.expect_error($q$insert into public.line_candidates (analysis_run_id, fixture_id, kickoff_utc, rule_version, rule_config_hash, scope, market_code, selection_code, n_prices, status)
  values ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', now(), '1.0.0', repeat('d', 64), 'all', '1X2', 'DRAW', 0, 'NO_VALUE')$q$, 'NO_VALUE without price', '23514');
select pg_temp.expect_error($q$insert into public.line_candidates (analysis_run_id, fixture_id, kickoff_utc, rule_version, rule_config_hash, scope, market_code, selection_code, p_pin, price, n_prices, edge, status)
  values ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', now(), '1.0.0', repeat('d', 64), 'all', '1X2', 'DRAW', 0.27, 3.4, 6, -0.08, 'LINE_VALUE')$q$, 'LINE_VALUE with negative edge', '23514');
select pg_temp.expect_error($q$insert into public.line_candidates (analysis_run_id, fixture_id, kickoff_utc, rule_version, rule_config_hash, scope, market_code, selection_code, n_prices, status)
  values ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', now(), '1.0.0', repeat('d', 64), 'all', 'OU', 'OVER', 0, 'INSUFFICIENT_DATA')$q$, 'O/U not in scope', '23514');
select pg_temp.expect_error($q$insert into public.line_candidates (analysis_run_id, fixture_id, kickoff_utc, rule_version, rule_config_hash, scope, market_code, selection_code, n_prices, status)
  values ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', now(), '1.0.0', repeat('d', 64), 'mine', '1X2', 'DRAW', 0, 'INSUFFICIENT_DATA')$q$, 'unknown scope', '23514');

-- the view lists priced candidates of final fixtures only
do $$ begin if (select count(*) from public.unsettled_line_candidates) <> 0 then raise exception 'scheduled fixture must not be unsettled-final'; end if; end $$;
update public.fixtures set status = 'FINISHED', home_goals = 2, away_goals = 1 where id = '00000000-0000-0000-0000-0000000006e1';
do $$ begin if (select count(*) from public.unsettled_line_candidates) <> 1 then raise exception 'expected one priced unsettled candidate'; end if; end $$;

-- outcomes: one per candidate, append-only, consistent closing fields
insert into public.line_candidate_outcomes (candidate_id, result, home_goals, away_goals, pin_close_odds, p_pin_close, clv, close_ev, profit_per_unit)
select id, 'WIN', 2, 1, 1.9, 0.51, 0.1316, 0.0965, 1.15 from public.line_candidates where status = 'LINE_VALUE';
do $$ begin if (select count(*) from public.unsettled_line_candidates) <> 0 then raise exception 'settled candidate still listed'; end if; end $$;
select pg_temp.expect_error('update public.line_candidate_outcomes set result = ''LOSS''', 'outcome update', '42501');
select pg_temp.expect_error($q$insert into public.line_candidate_outcomes (candidate_id, result, profit_per_unit) select id, 'LOSS', -1 from public.line_candidates where status = 'LINE_VALUE'$q$, 'second outcome', '23505');
select pg_temp.expect_error($q$insert into public.line_candidate_outcomes (candidate_id, result, profit_per_unit, pin_close_odds) select id, 'LOSS', -1, 1.9 from public.line_candidates where selection_code = 'AWAY'$q$, 'close odds without CLV', '23514');
select pg_temp.expect_error($q$insert into public.line_candidate_outcomes (candidate_id, result, profit_per_unit) select id, 'VOID', 0 from public.line_candidates where selection_code = 'AWAY'$q$, 'VOID with profit', '23514');

-- API roles have no access
do $$
begin
  if has_table_privilege('anon', 'public.line_candidates', 'select') or has_table_privilege('authenticated', 'public.line_candidate_outcomes', 'select')
     or has_table_privilege('anon', 'public.unsettled_line_candidates', 'select') then
    raise exception 'API roles must not read line tables';
  end if;
end;
$$;

select 'line_candidates tests passed';
rollback;

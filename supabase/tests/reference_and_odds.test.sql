-- Assertions for migration 20261015000001. Run after the migrations on an empty database:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/reference_and_odds.test.sql
-- Every block raises (and fails the run) if an expectation does not hold.

-- Fails unless `sql` raises exactly SQLSTATE `state` (a typo in the statement would raise
-- a different state and fail the test instead of passing it).
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
  ('00000000-0000-0000-0000-000000000001', 'Arsenal'),
  ('00000000-0000-0000-0000-000000000002', 'Chelsea');
insert into public.fixtures (id, competition_code, season, home_team_id, away_team_id, kickoff_utc, status, source_provider, provider_fixture_id)
values ('00000000-0000-0000-0000-0000000000f1', 'EPL', 2026, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
        '2026-10-18T14:00:00Z', 'SCHEDULED', 'football_data_org', '1001');
insert into public.bookmakers (source_provider, provider_bookmaker_key, name) values ('the_odds_api', 'pinnacle', 'Pinnacle');
insert into public.odds_snapshots (fixture_id, source_provider, provider_event_id, bookmaker_id, market_code, selection_code, line, decimal_odds, kind, captured_at, capture_batch_id)
values ('00000000-0000-0000-0000-0000000000f1', 'the_odds_api', 'ev1', 1, 'OU', 'OVER', 2.5, 1.9, 'pre_match', now(), gen_random_uuid());
insert into public.odds_credit_ledger (month, purpose, credits) values ('2026-10', 'scanner', 2);

-- competitions seeded
do $$ begin
  if (select count(*) from public.competitions) <> 7 then raise exception 'expected 7 competitions'; end if;
  if (select model_applicable from public.competitions where code = 'UCL') then raise exception 'UCL must not be model-applicable'; end if;
end $$;

-- append-only odds snapshots and credit ledger
select pg_temp.expect_error('update public.odds_snapshots set decimal_odds = 2.0', 'odds update', '42501');
select pg_temp.expect_error('delete from public.odds_snapshots', 'odds delete', '42501');
select pg_temp.expect_error('truncate public.odds_snapshots', 'odds truncate', '42501');
select pg_temp.expect_error('update public.odds_credit_ledger set credits = 0', 'ledger update', '42501');
select pg_temp.expect_error('delete from public.odds_credit_ledger', 'ledger delete', '42501');

-- odds validity and market/selection/line consistency
select pg_temp.expect_error($q$insert into public.odds_snapshots (source_provider, provider_event_id, bookmaker_id, market_code, selection_code, line, decimal_odds, kind, captured_at, capture_batch_id) values ('x','e',1,'1X2','HOME',null,1.0,'pre_match',now(),gen_random_uuid())$q$, 'odds 1.0', '23514');
select pg_temp.expect_error($q$insert into public.odds_snapshots (source_provider, provider_event_id, bookmaker_id, market_code, selection_code, line, decimal_odds, kind, captured_at, capture_batch_id) values ('x','e',1,'OU','OVER',2.75,1.9,'pre_match',now(),gen_random_uuid())$q$, 'quarter line', '23514');
select pg_temp.expect_error($q$insert into public.odds_snapshots (source_provider, provider_event_id, bookmaker_id, market_code, selection_code, line, decimal_odds, kind, captured_at, capture_batch_id) values ('x','e',1,'1X2','HOME',2.5,1.9,'pre_match',now(),gen_random_uuid())$q$, '1X2 with line', '23514');
select pg_temp.expect_error($q$insert into public.odds_snapshots (source_provider, provider_event_id, bookmaker_id, market_code, selection_code, line, decimal_odds, kind, captured_at, capture_batch_id) values ('x','e',1,'DC','HOME',null,1.9,'pre_match',now(),gen_random_uuid())$q$, 'bad DC selection', '23514');

-- fixture integrity
select pg_temp.expect_error($q$insert into public.fixtures (competition_code, season, home_team_id, away_team_id, kickoff_utc, status, source_provider, provider_fixture_id) values ('EPL',2026,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',now(),'SCHEDULED','p','x1')$q$, 'same team twice', '23514');
select pg_temp.expect_error($q$insert into public.fixtures (competition_code, season, home_team_id, away_team_id, kickoff_utc, status, source_provider, provider_fixture_id) values ('EPL',2026,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',now(),'FINISHED','p','x2')$q$, 'finished without score', '23514');
select pg_temp.expect_error($q$insert into public.fixtures (competition_code, season, home_team_id, away_team_id, kickoff_utc, status, source_provider, provider_fixture_id) values ('XXX',2026,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',now(),'SCHEDULED','p','x3')$q$, 'unknown competition', '23503');
select pg_temp.expect_error($q$insert into public.fixtures (competition_code, season, home_team_id, away_team_id, kickoff_utc, status, source_provider, provider_fixture_id) values ('EPL',2026,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','2026-10-18T14:00:00Z','SCHEDULED','football_data_org','1001')$q$, 'duplicate provider fixture', '23505');

-- fixtures stay mutable (status/score updates)
update public.fixtures set status = 'FINISHED', home_goals = 2, away_goals = 1 where provider_fixture_id = '1001';

-- request log never stores query strings (API keys travel in query strings)
select pg_temp.expect_error($q$insert into public.provider_request_log (source_provider, endpoint, http_status) values ('the_odds_api','/v4/sports?apiKey=x',200)$q$, 'query string in log', '23514');

-- RLS enabled on every FVIS table; anon/authenticated have no table privileges
do $$
declare r record;
begin
  for r in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' loop
    if not r.relrowsecurity then raise exception 'RLS not enabled on %', r.relname; end if;
    if has_table_privilege('anon', 'public.' || r.relname, 'select') then raise exception 'anon can read %', r.relname; end if;
    if has_table_privilege('authenticated', 'public.' || r.relname, 'select') then raise exception 'authenticated can read %', r.relname; end if;
  end loop;
end $$;

-- odds_events: upsertable metadata, competition must exist
insert into public.odds_events (source_provider, provider_event_id, competition_code, kickoff_utc, home_team_name, away_team_name)
values ('the_odds_api', 'ev-uel-1', 'UEL', '2026-10-23T16:45:00Z', 'Roma', 'Ajax');
update public.odds_events set kickoff_utc = '2026-10-23T19:00:00Z', last_seen_at = now() where provider_event_id = 'ev-uel-1';
select pg_temp.expect_error($q$insert into public.odds_events (source_provider, provider_event_id, competition_code, kickoff_utc, home_team_name, away_team_name) values ('x','e','NOPE',now(),'a','b')$q$, 'odds_events unknown competition', '23503');

select 'ALL DB ASSERTIONS PASSED' as result;

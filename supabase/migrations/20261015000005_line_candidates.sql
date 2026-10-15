-- FVIS Phase 6d — line-shopping paper tracker (D-24, docs/23).
-- Append-only: candidates and outcomes are never updated after insert.

-- ---------------------------------------------------------------- candidates (append-only)

create table public.line_candidates (
  id                bigint generated always as identity primary key,
  analysis_run_id   uuid not null references public.analysis_runs (id),
  fixture_id        uuid not null references public.fixtures (id),
  kickoff_utc       timestamptz not null,
  rule_version      text not null check (rule_version ~ '^\d+\.\d+\.\d+$'),
  rule_config_hash  text not null check (rule_config_hash ~ '^[0-9a-f]{64}$'),
  scope             text not null check (scope in ('all', 'playable')),   -- playable: bookmakers available to the PO
  market_code       text not null check (market_code = '1X2'),
  selection_code    text not null check (selection_code in ('HOME', 'DRAW', 'AWAY')),
  pin_snapshot_id   bigint references public.odds_snapshots (id),
  pin_odds          numeric(8, 3),
  p_pin             double precision check (p_pin between 0 and 1),        -- de-vigged Pinnacle probability
  pin_overround     double precision,
  pin_captured_at   timestamptz,
  price_snapshot_id bigint references public.odds_snapshots (id),
  bookmaker_key     text,
  price             numeric(8, 3) check (price >= 1.01),
  median_price      double precision,
  n_prices          integer not null check (n_prices >= 0),
  edge              double precision,                                     -- p_pin × price − 1
  status            text not null check (status in ('INSUFFICIENT_DATA', 'NO_VALUE', 'WATCHLIST', 'LINE_VALUE')),
  reason_codes      text[] not null default '{}',
  created_at        timestamptz not null default now(),
  check (status = 'INSUFFICIENT_DATA' or (price is not null and p_pin is not null and edge is not null)),
  check (status not in ('WATCHLIST', 'LINE_VALUE') or edge > 0),
  -- the same odds give the same row: re-runs on unchanged odds insert nothing
  unique nulls not distinct (fixture_id, selection_code, scope, pin_snapshot_id, price_snapshot_id)
);
create index line_candidates_fixture_idx on public.line_candidates (fixture_id, id);
create index line_candidates_status_idx on public.line_candidates (status, scope, created_at);

-- ---------------------------------------------------------------- outcomes (append-only, one per candidate)

create table public.line_candidate_outcomes (
  candidate_id       bigint primary key references public.line_candidates (id),
  settled_at         timestamptz not null default now(),
  result             text not null check (result in ('WIN', 'LOSS', 'VOID')),
  home_goals         integer check (home_goals >= 0),
  away_goals         integer check (away_goals >= 0),
  close_snapshot_id  bigint references public.odds_snapshots (id),
  pin_close_odds     numeric(8, 3),
  p_pin_close        double precision check (p_pin_close between 0 and 1),
  clv                double precision,          -- price / Pinnacle close − 1
  close_ev           double precision,          -- p_pin_close × price − 1
  profit_per_unit    double precision,          -- paper evaluation only (1 notional unit)
  check ((result = 'VOID') = (profit_per_unit is null)),
  check ((pin_close_odds is null) = (clv is null) and (clv is null) = (close_ev is null))
);

-- ---------------------------------------------------------------- unsettled candidates of final fixtures

create view public.unsettled_line_candidates with (security_invoker = true) as
select
  c.id          as candidate_id,
  c.fixture_id,
  c.selection_code,
  c.price,
  f.status      as fixture_status,
  f.home_goals,
  f.away_goals,
  f.kickoff_utc
from public.line_candidates c
join public.fixtures f on f.id = c.fixture_id
where c.price is not null
  and f.status in ('FINISHED', 'CANCELLED', 'AWARDED')
  and not exists (select 1 from public.line_candidate_outcomes o where o.candidate_id = c.id);

-- ---------------------------------------------------------------- append-only enforcement

do $$
declare t text;
begin
  foreach t in array array['line_candidates', 'line_candidate_outcomes'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.fvis_forbid_mutation()', t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.fvis_forbid_mutation()', t || '_no_truncate', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- access control

do $$
declare t text;
begin
  foreach t in array array['line_candidates', 'line_candidate_outcomes'] loop
    execute format('alter table public.%I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.unsettled_line_candidates from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.unsettled_line_candidates from authenticated;
  end if;
end;
$$;

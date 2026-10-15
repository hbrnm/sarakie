-- FVIS Phase 2.2 — reference data, fixtures, odds snapshots, provider usage.
-- Timestamps are timestamptz (UTC). Append-only tables reject UPDATE/DELETE/TRUNCATE.
-- RLS is enabled everywhere with no policies: only the server-side service role has access.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers

create or replace function public.fvis_forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FVIS: table %.% is append-only (% not allowed)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------- reference data

create table public.competitions (
  code             text primary key check (code ~ '^[A-Z0-9]{2,12}$'),
  name             text not null,
  country          text not null,
  type             text not null check (type in ('domestic', 'uefa')),
  model_applicable boolean not null
);

insert into public.competitions (code, name, country, type, model_applicable) values
  ('EPL', 'Premier League', 'England', 'domestic', true),
  ('LALIGA', 'La Liga', 'Spain', 'domestic', true),
  ('SERIEA', 'Serie A', 'Italy', 'domestic', true),
  ('BUNDESLIGA', 'Bundesliga', 'Germany', 'domestic', true),
  ('LIGUE1', 'Ligue 1', 'France', 'domestic', true),
  ('UCL', 'UEFA Champions League', 'Europe', 'uefa', false),
  ('UEL', 'UEFA Europa League', 'Europe', 'uefa', false);

create table public.provider_competition_map (
  source_provider         text not null,
  provider_competition_id text not null,
  competition_code        text not null references public.competitions (code),
  provider_name           text not null,
  current_season          integer check (current_season between 1990 and 2100),
  discovered_at           timestamptz not null default now(),
  primary key (source_provider, provider_competition_id)
);

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  country    text,
  created_at timestamptz not null default now()
);

-- Provider identity of a team: provider team ID where one exists, else the provider's name.
create table public.provider_team_map (
  source_provider   text not null,
  provider_team_ref text not null,
  team_id           uuid not null references public.teams (id),
  provider_name     text not null,
  match_method      text not null check (match_method in ('primary', 'alias', 'exact', 'token_subset', 'manual')),
  created_at        timestamptz not null default now(),
  primary key (source_provider, provider_team_ref)
);
create index provider_team_map_team_idx on public.provider_team_map (team_id);

-- ---------------------------------------------------------------- fixtures (mutable: status and score change)

create table public.fixtures (
  id                  uuid primary key default gen_random_uuid(),
  competition_code    text not null references public.competitions (code),
  season              integer not null check (season between 1990 and 2100),
  home_team_id        uuid not null references public.teams (id),
  away_team_id        uuid not null references public.teams (id),
  kickoff_utc         timestamptz not null,
  status              text not null check (status in ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED', 'AWARDED')),
  home_goals          integer check (home_goals >= 0),
  away_goals          integer check (away_goals >= 0),
  matchday            integer,
  stage               text,
  source_provider     text not null,
  provider_fixture_id text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source_provider, provider_fixture_id),
  check (home_team_id <> away_team_id),
  check ((home_goals is null) = (away_goals is null)),
  check (status <> 'FINISHED' or home_goals is not null)
);
create index fixtures_competition_kickoff_idx on public.fixtures (competition_code, kickoff_utc);
create index fixtures_teams_idx on public.fixtures (home_team_id, away_team_id, kickoff_utc);

-- ---------------------------------------------------------------- odds (append-only)

create table public.bookmakers (
  id                     bigint generated always as identity primary key,
  source_provider        text not null,
  provider_bookmaker_key text not null,
  name                   text not null,
  unique (source_provider, provider_bookmaker_key)
);

create table public.odds_snapshots (
  id                bigint generated always as identity primary key,
  fixture_id        uuid references public.fixtures (id),
  source_provider   text not null,
  provider_event_id text not null,
  bookmaker_id      bigint not null references public.bookmakers (id),
  market_code       text not null,
  selection_code    text not null,
  line              numeric(4, 2),
  decimal_odds      numeric(8, 3) not null check (decimal_odds >= 1.01 and decimal_odds <= 1000),
  kind              text not null check (kind in ('pre_match', 'closing')),
  source_timestamp  timestamptz,
  captured_at       timestamptz not null,
  capture_batch_id  uuid not null,
  check (
    (market_code = '1X2' and selection_code in ('HOME', 'DRAW', 'AWAY') and line is null) or
    (market_code = 'DC' and selection_code in ('1X', '12', 'X2') and line is null) or
    (market_code = 'DNB' and selection_code in ('HOME', 'AWAY') and line is null) or
    (market_code = 'BTTS' and selection_code in ('YES', 'NO') and line is null) or
    (market_code = 'OU' and selection_code in ('OVER', 'UNDER') and line in (1.5, 2.5, 3.5))
  )
);
create index odds_snapshots_fixture_idx on public.odds_snapshots (fixture_id, captured_at);
create index odds_snapshots_event_idx on public.odds_snapshots (source_provider, provider_event_id, captured_at);

create trigger odds_snapshots_append_only
  before update or delete on public.odds_snapshots
  for each row execute function public.fvis_forbid_mutation();
create trigger odds_snapshots_no_truncate
  before truncate on public.odds_snapshots
  for each statement execute function public.fvis_forbid_mutation();

-- Linking an odds event to a fixture after capture is done through this table,
-- so snapshots never need an UPDATE.
create table public.odds_event_links (
  source_provider   text not null,
  provider_event_id text not null,
  fixture_id        uuid not null references public.fixtures (id),
  linked_at         timestamptz not null default now(),
  primary key (source_provider, provider_event_id)
);

-- ---------------------------------------------------------------- provider usage

create table public.provider_request_log (
  id                bigint generated always as identity primary key,
  source_provider   text not null,
  endpoint          text not null check (endpoint !~ '[?]'),   -- path only, never a query string
  requested_at      timestamptz not null default now(),
  http_status       integer not null,
  duration_ms       integer,
  attempt           integer not null default 0,
  credits_last      integer,
  credits_remaining integer
);
create index provider_request_log_provider_time_idx on public.provider_request_log (source_provider, requested_at);

create table public.odds_credit_ledger (
  id                 bigint generated always as identity primary key,
  month              text not null check (month ~ '^\d{4}-\d{2}$'),
  purpose            text not null check (purpose in ('scanner', 'on_demand', 'other')),
  credits            integer not null check (credits >= 0),
  provider_remaining integer,
  recorded_at        timestamptz not null default now()
);
create index odds_credit_ledger_month_idx on public.odds_credit_ledger (month);

create trigger odds_credit_ledger_append_only
  before update or delete on public.odds_credit_ledger
  for each row execute function public.fvis_forbid_mutation();
create trigger odds_credit_ledger_no_truncate
  before truncate on public.odds_credit_ledger
  for each statement execute function public.fvis_forbid_mutation();

-- ---------------------------------------------------------------- access control

do $$
declare t text;
begin
  foreach t in array array[
    'competitions', 'provider_competition_map', 'teams', 'provider_team_map', 'fixtures',
    'bookmakers', 'odds_snapshots', 'odds_event_links', 'provider_request_log', 'odds_credit_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
  end loop;
end;
$$;

-- FVIS Phase 2.3 — odds event metadata.
-- Odds snapshots reference provider events; this table keeps each event's teams and kickoff
-- so events can be shown even without a linked fixture (e.g. UEFA Europa League, which the
-- football-data.org free tier does not cover). Mutable: kickoff times can change.

create table public.odds_events (
  source_provider   text not null,
  provider_event_id text not null,
  competition_code  text not null references public.competitions (code),
  kickoff_utc       timestamptz not null,
  home_team_name    text not null,
  away_team_name    text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  primary key (source_provider, provider_event_id)
);
create index odds_events_competition_kickoff_idx on public.odds_events (competition_code, kickoff_utc);

alter table public.odds_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.odds_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.odds_events from authenticated;
  end if;
end;
$$;

-- Short display names for Telegram output (e.g. "Man United" instead of "Manchester United FC").
alter table public.teams add column short_name text;

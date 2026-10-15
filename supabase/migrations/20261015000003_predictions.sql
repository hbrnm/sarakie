-- FVIS Phase 5.1 — analysis runs, append-only predictions, outcomes, explanations, digests.
-- Model: docs/05-data-dictionary.md. Timestamps are timestamptz (UTC).
-- Append-only tables reject UPDATE/DELETE/TRUNCATE (public.fvis_forbid_mutation, migration 1).

-- ---------------------------------------------------------------- model versions (immutable)

create table public.model_versions (
  id            bigint generated always as identity primary key,
  model_family  text not null,
  model_version text not null check (model_version ~ '^\d+\.\d+\.\d+$'),
  config        jsonb not null,
  config_hash   text not null unique check (config_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  notes         text
);

-- ---------------------------------------------------------------- analysis runs (mutable: status, counts)

create table public.analysis_runs (
  id                  uuid primary key default gen_random_uuid(),
  trigger             text not null check (trigger in ('scanner', 'on_demand', 'backtest')),
  scan_date           date,                          -- Europe/Bucharest calendar day of a scanner run
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  as_of               timestamptz not null,
  model_version_id    bigint references public.model_versions (id),
  risk_version        text not null,
  risk_config_hash    text not null check (risk_config_hash ~ '^[0-9a-f]{64}$'),
  fixtures_considered integer not null default 0 check (fixtures_considered >= 0),
  fixtures_analyzed   integer not null default 0 check (fixtures_analyzed >= 0),
  fixtures_recorded   integer not null default 0 check (fixtures_recorded >= 0),
  credits_used        integer not null default 0 check (credits_used >= 0),
  status              text not null default 'RUNNING' check (status in ('RUNNING', 'OK', 'PARTIAL', 'FAILED')),
  error_summary       text,
  check ((trigger = 'scanner') = (scan_date is not null)),
  check ((status = 'RUNNING') = (finished_at is null))
);
create index analysis_runs_scan_date_idx on public.analysis_runs (scan_date, status);
create index analysis_runs_started_idx on public.analysis_runs (started_at);

-- ---------------------------------------------------------------- predictions (append-only)

create table public.predictions (
  id                bigint generated always as identity primary key,
  analysis_run_id   uuid not null references public.analysis_runs (id),
  fixture_id        uuid not null references public.fixtures (id),
  model_version_id  bigint not null references public.model_versions (id),
  risk_version      text not null,
  risk_config_hash  text not null,
  mode              text not null check (mode in ('scanner', 'on_demand')),
  input_hash        text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  as_of             timestamptz not null,
  data_cutoff_utc   timestamptz,
  created_at        timestamptz not null default now(),
  market_code       text not null,
  selection_code    text not null,
  line              numeric(4, 2),
  lambda_home       double precision,
  lambda_away       double precision,
  p_model           double precision check (p_model between 0 and 1),
  p_push            double precision check (p_push between 0 and 1),
  p_loss            double precision check (p_loss between 0 and 1),
  fair_odds         double precision,
  odds_snapshot_id  bigint references public.odds_snapshots (id),
  bookmaker_key     text,
  decimal_odds      numeric(8, 3) check (decimal_odds >= 1.01),
  p_raw             double precision,
  p_devig           double precision,
  overround         double precision,
  ev                double precision,
  bookmaker_count   integer,
  status            text not null check (status in ('INSUFFICIENT_DATA', 'NO_VALUE', 'WATCHLIST', 'QUALIFIED')),
  reason_codes      text[] not null default '{}',
  notes             text[] not null default '{}',
  diagnostics       jsonb not null default '{}',
  check (
    (market_code = '1X2' and selection_code in ('HOME', 'DRAW', 'AWAY') and line is null) or
    (market_code = 'DC' and selection_code in ('1X', '12', 'X2') and line is null) or
    (market_code = 'DNB' and selection_code in ('HOME', 'AWAY') and line is null) or
    (market_code = 'BTTS' and selection_code in ('YES', 'NO') and line is null) or
    (market_code = 'OU' and selection_code in ('OVER', 'UNDER') and line in (1.5, 2.5, 3.5))
  ),
  -- a value status always carries the exact quote and EV it was computed from
  check (status = 'INSUFFICIENT_DATA' or (decimal_odds is not null and ev is not null and p_model is not null)),
  check (status not in ('WATCHLIST', 'QUALIFIED') or ev > 0),
  check (as_of <= created_at + interval '1 minute'),
  unique nulls not distinct (analysis_run_id, fixture_id, market_code, selection_code, line)
);
create index predictions_fixture_idx on public.predictions (fixture_id, id);
create index predictions_run_idx on public.predictions (analysis_run_id);
create index predictions_status_idx on public.predictions (status, created_at);

-- ---------------------------------------------------------------- outcomes (append-only, one per prediction)

create table public.prediction_outcomes (
  prediction_id            bigint primary key references public.predictions (id),
  settled_at               timestamptz not null default now(),
  result                   text not null check (result in ('WIN', 'LOSS', 'PUSH', 'VOID')),
  home_goals               integer check (home_goals >= 0),
  away_goals               integer check (away_goals >= 0),
  closing_odds_snapshot_id bigint references public.odds_snapshots (id),
  profit_per_unit          double precision,     -- paper evaluation only (1 notional unit)
  check ((result = 'VOID') = (profit_per_unit is null))
);

-- ---------------------------------------------------------------- explanations (append-only)

create table public.explanations (
  id               bigint generated always as identity primary key,
  analysis_run_id  uuid not null references public.analysis_runs (id),
  fixture_id       uuid not null references public.fixtures (id),
  generator        text not null check (generator in ('gemini', 'template')),
  model_id         text,
  validated        boolean not null,
  rejection_reason text,
  text             text not null check (length(text) between 1 and 8000),
  created_at       timestamptz not null default now(),
  unique (analysis_run_id, fixture_id)
);

-- ---------------------------------------------------------------- scanner digests (append-only, one per day)

create table public.scan_digests (
  scan_date       date primary key,
  analysis_run_id uuid not null references public.analysis_runs (id),
  text            text not null check (length(text) between 1 and 20000),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- append-only enforcement

do $$
declare t text;
begin
  foreach t in array array['model_versions', 'predictions', 'prediction_outcomes', 'explanations', 'scan_digests'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.fvis_forbid_mutation()', t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.fvis_forbid_mutation()', t || '_no_truncate', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- access control

do $$
declare t text;
begin
  foreach t in array array['model_versions', 'analysis_runs', 'predictions', 'prediction_outcomes', 'explanations', 'scan_digests'] loop
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

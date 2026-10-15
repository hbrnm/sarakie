-- FVIS Phase 5.4 — settlement support.
-- Predictions whose fixture has a final state and that have no outcome yet. The view runs
-- with the caller's privileges (security_invoker), so it never bypasses RLS, and it is not
-- exposed to the anon/authenticated API roles.

create view public.unsettled_predictions with (security_invoker = true) as
select
  p.id           as prediction_id,
  p.fixture_id,
  p.market_code,
  p.selection_code,
  p.line,
  p.decimal_odds,
  f.status       as fixture_status,
  f.home_goals,
  f.away_goals
from public.predictions p
join public.fixtures f on f.id = p.fixture_id
where f.status in ('FINISHED', 'CANCELLED', 'AWARDED')
  and not exists (select 1 from public.prediction_outcomes o where o.prediction_id = p.id);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.unsettled_predictions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.unsettled_predictions from authenticated;
  end if;
end;
$$;

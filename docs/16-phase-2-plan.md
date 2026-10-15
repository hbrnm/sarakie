# 16 — Phase 2 Plan: Football Data Integration

Authorized 2026-10-15 (`CLAUDE.md` §17). Delivered in three increments; each is merged only with Product Owner approval.

## 2.1 — Provider adapters and normalization (this increment)

| Component | File | Notes |
|---|---|---|
| Competition catalog | `src/domain/competitions.js` | 5 domestic leagues + UCL/UEL (`modelApplicable: false`, D-13) |
| Market codes and odds validity | `src/domain/markets.js` | O/U lines 1.5/2.5/3.5 only; quarter lines excluded |
| Normalized types | `src/domain/types.js` | `Fixture`, `OddsQuote`, `NormalizationReport` |
| HTTP client | `src/providers/http.js` | timeout, retry only on network/5xx, no retry on 4xx/429, secret redaction |
| football-data.org | `src/providers/footballDataOrg/` | discovery by name + area; 6.5 s request spacing (10/min); regular-time scores only |
| The Odds API | `src/providers/oddsApi/` | discovery by sport title; every paid call goes through the credit budget |
| Credit budget | `src/providers/oddsApi/creditBudget.js` | 500/month, reserve 50, on-demand cap 200 (D-11); in-memory store until 2.2 |
| football-data.co.uk | `src/providers/footballDataCoUk/` | CSV parser; UK local time → UTC; closing odds, complete sets only |
| Team matching | `src/domain/teams/` | alias groups → exact → unique token subset; never guesses |
| Event ↔ fixture linking | `src/domain/teams/matching.js` | same teams, kickoff ±180 min |
| Live smoke test | `scripts/adapter-smoke.js`, workflow `adapter-smoke` | manual; ≤ 14 odds credits; produces the team-mapping report |

Known open points:
- **UEL** is probably not in the football-data.org free tier. The adapter reports `NO_PROVIDER_COVERAGE`; the smoke test confirms it.
- The Odds API **double-chance outcome naming** is unverified (S-52). Unknown forms are dropped and counted.
- The alias table is a starter list, to be extended from the smoke-test mapping report.

## 2.2 — Persistence

Status 2026-10-15:
- Supabase project `fvis` (ref `tqelifzgatxkdzifbyhr`) created by Claude through the Supabase connector in organization "atlasculinar" (free plan, `eu-central-1`, Postgres 17), at the Product Owner's request after the connector was relinked to this account.
- An earlier `fvis` project (ref `oyfznftillyxhsaxaxnw`, organization "Camara") was created before the relink and is **not used**. Deleting it, or leaving it to pause, is the Product Owner's decision.
- Migration `20261015000001_reference_and_odds` applied. Verified read-only on Supabase: 10 tables, RLS on all, no table readable by `anon`/`authenticated`, 4 append-only triggers, 7 competitions seeded. Security advisor: only the expected INFO "RLS enabled, no policy" (access is server-side only).
- Behavioural assertions (`supabase/tests/`) run in CI on a clean Postgres 17. They are deliberately **not** run on Supabase, because they would leave undeletable rows in append-only tables.

Remaining:

- SQL migrations under `supabase/migrations/`: competitions, provider maps, teams + aliases, fixtures, bookmakers, `odds_snapshots` (append-only trigger), `provider_request_log`, `odds_credit_ledger`.
- RLS enabled on every table with no anon policies.
- Repositories in `src/persistence/`; Supabase-backed credit store replaces the in-memory one.
- History backfill from football-data.co.uk (2 seasons × 5 leagues).

## 2.3 — Telegram data commands

- `/fixtures [league]`: upcoming fixtures, including UCL/UEL marked "informativ".
- `/quota`: football-data.org usage and Odds API credits this month.
- Odds capture job (GitHub Actions) following D-11, without the model (the model is Phase 3).

## Exit criteria

See [11 — Phase 2](11-acceptance-criteria.md), plus: live smoke test green with all 5 domestic leagues discovered, ≥ 95% of odds-provider team names mapped, and every unmapped name listed.

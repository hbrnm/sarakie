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

## 2.1 live smoke test — results (run 38703516262, 2026-10-15)

| Competition | fd.org teams | Fixtures 7 d | Odds events | Odds names mapped | Events linked | CSV names mapped |
|---|---|---|---|---|---|---|
| EPL | 20 | 10 | 20 | 20/20 | 10/10 | 20/20 |
| LALIGA | 20 | 11 | 21 | 20/20 | 11/11 | 20/20 |
| SERIEA | 20 | 10 | 20 | 20/20 | 10/10 | 20/20 |
| BUNDESLIGA | 18 | 9 | 18 | 18/18 | 9/9 | 18/18 |
| LIGUE1 | 18 | 9 | 18 | 18/18 | 9/9 | 18/18 |
| UCL | 36 | 18 | 18 | 34/36 | 16/18 | — |
| UEL | **not on football-data.org free tier** | — | 18 | — | — | — |

- Domestic leagues: 100% team mapping across all three sources; every odds event in the window linked to its fixture.
- UCL: `AEK Athens` and `Sporting Lisbon` unmatched; aliases added (verify on the next run).
- UEL: odds available (The Odds API), fixtures not available on the football-data.org free tier. UEL is therefore odds-only information (D-13 still holds: no model output).
- Featured odds cost exactly 2 credits per competition; 14 credits for all 7. 457 credits remained after the run.
- Featured `totals` carries several lines per event. O/U 2.5 and 3.5 are well covered; O/U 1.5 rarely appears (needs `alternate_totals`, on-demand per D-11).

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

## 2.2 history backfill — results (run 38704530362, 2026-10-15)

Verified read-only on Supabase after the run:

| League | Season | Fixtures (finished, scored) | With closing odds | Avg goals (home / away) |
|---|---|---|---|---|
| EPL | 2025 | 380 | 380 | 2.75 (1.53 / 1.22) |
| EPL | 2026 | 60 | 60 | 2.95 (1.62 / 1.33) |
| LALIGA | 2025 | 380 | 380 | 2.69 (1.57 / 1.12) |
| LALIGA | 2026 | 78 | 78 | 3.09 (1.76 / 1.33) |
| SERIEA | 2025 | 380 | 380 | 2.43 (1.28 / 1.15) |
| SERIEA | 2026 | 60 | 60 | 2.87 (1.55 / 1.32) |
| BUNDESLIGA | 2025 | 306 | 306 | 3.24 (1.78 / 1.46) |
| BUNDESLIGA | 2026 | 43 | 43 | 3.86 (2.37 / 1.49) |
| LIGUE1 | 2025 | 305 | 305 | 2.83 (1.59 / 1.24) |
| LIGUE1 | 2026 | 54 | 54 | 2.91 (1.67 / 1.24) |

- 2,046 finished fixtures; 110 canonical teams; all 110 football-data.co.uk team names mapped (alias 32, exact 70, token subset 8); no unmatched names.
- 35,164 closing-odds rows (1X2 and O/U 2.5; bookmakers: Bet365, Pinnacle where present, market average, market maximum), all linked to fixtures.
- Ligue 1 2025: 305 fixtures from football-data.org versus 306 CSV rows. One match is not reported as finished by football-data.org (likely awarded or annulled); to be checked, no impact on linking.
- 31 provider requests logged, none containing a query string. Database size 20 MB of the 500 MB free limit.
- Current-season samples are still small (43–78 matches per league), which is relevant for the model's sample-size gates (spec §6).

## 2.3 — Daily sync and Telegram data commands (implemented, pending merge)

| Component | File | Notes |
|---|---|---|
| Migration 2 | `supabase/migrations/20261015000002_odds_events.sql` | `odds_events` (teams + kickoff per odds event, needed for UEL), `teams.short_name` |
| Daily sync job | `src/jobs/dailySync.js`, `scripts/daily-sync.js` | fixtures −3/+7 days for the 6 competitions football-data.org covers; featured odds only where a match is within 48 h; UEL via the odds events list; credit budget enforced from the Supabase ledger |
| Workflow | `.github/workflows/daily-sync.yml` | cron `17 7 * * *` UTC = 10:17 Bucharest in summer time, 09:17 in winter time (from 25 Oct 2026); best effort; manual run possible |
| Bot | `/fixtures [league]`, `/quota` | reads Supabase; UCL/UEL marked informational; messages split under the Telegram limit; graceful answer if the database is unavailable |

Estimated cost: ≤ 2 credits per competition with a match in the next 48 h, so ≤ 12 credits on a busy day, about 150–250 credits per month (to be measured). The on-demand cap (200) and reserve (50) are unchanged.

## 2.3 — original plan (Telegram data commands)

- `/fixtures [league]`: upcoming fixtures, including UCL/UEL marked "informativ".
- `/quota`: football-data.org usage and Odds API credits this month.
- Odds capture job (GitHub Actions) following D-11, without the model (the model is Phase 3).

## Exit criteria

See [11 — Phase 2](11-acceptance-criteria.md), plus: live smoke test green with all 5 domestic leagues discovered, ≥ 95% of odds-provider team names mapped, and every unmapped name listed.

# 20 — Phase 5 Plan: Scanner and Prediction Tracking

Status: **APPROVED** by the Product Owner on 2026-10-15 (D-08, D-14 … D-17).

## 1. Verified starting state (2026-10-15)

| Item | Evidence |
|---|---|
| Branch `claude/faza-5-handoff-ssi9x5` = `main` + nothing; working tree clean | `git status`, `git log` (HEAD `d24ee79`) |
| 144/144 tests pass, lint clean | `npm test`, `npx eslint .` |
| Supabase `fvis` (`tqelifzgatxkdzifbyhr`): migrations 1–2 only | `list_migrations` |
| 2,131 fixtures (2,064 finished), 42,773 odds snapshots, 39 `odds_event_links`, last capture 2026-10-15 08:37 UTC | SQL count |
| October odds credits: 10 used, 447 remaining (provider) | `odds_credit_ledger` |
| Database size 22 MB of 500 MB | `pg_database_size` |

Not yet present: `predictions`, `analysis_runs`, `model_versions`, `prediction_outcomes`, `explanations`, `pipeline/`, `jobs/scan.js`, `/analyze`, `/scan`, backup job.

## 2. Sub-phases (each ends with a PO-approved merge)

### 5.1 — Persistence and shared pipeline

- **Migration 3** (per [05](05-data-dictionary.md)): `model_versions` (model + risk config, unique `config_hash`), `analysis_runs` (`trigger`, `as_of`, `scan_date`, status, counts), `predictions` (one row per run × fixture × selection; all 16 selections, including `INSUFFICIENT_DATA`, so coverage is measurable), `prediction_outcomes`, `explanations`, `scan_digests` (unique `scan_date` → no duplicate digests). Append-only triggers on `predictions`, `prediction_outcomes`, `model_versions`, `scan_digests`; RLS on, no anon/authenticated access. DB test asserts `UPDATE`/`DELETE`/`TRUNCATE` fail.
- **`src/pipeline/analyzeFixture.js`**: load history from DB (`kickoff < asOf`) → `estimate` → load quotes by fixture, resolving provider events through `odds_event_links` **and** `odds_snapshots.fixture_id` → `evaluateFixture` → returns a result; no I/O inside domain code. Both scanner and `/analyze` call this function only (§4.5).
- **`recordPredictions`**: inserts the run, the selections and the explanation. Re-analysis inserts new rows; nothing is updated. A fixture is re-recorded in a later run only when its inputs changed (new odds batch or new history), so duplicated runs do not inflate the table.

### 5.2 — Daily scanner and digest

- `src/jobs/scan.js` + `scripts/scan.js`, run as a **second step of the existing `daily-sync` workflow**, so it uses odds captured in the same run (option A, ≤ 6 h).
- Scope: fixtures of the 5 domestic leagues kicking off in the next 48 h (UCL/UEL shown as information only, D-13).
- Telegram digest (Romanian): QUALIFIED and WATCHLIST items with odds, model probability, EV, reasons; coverage summary (fixtures scanned, `INSUFFICIENT_DATA` count, credits used/remaining); mandatory disclaimer. Sent through the Bot API to every allowlisted user ID; idempotent per `scan_date` via `scan_digests`.
- `/scan`: re-sends the latest digest from the database (no re-run, no credits).
- **Missed-run detection**: a second cron (about 3 h after the main one) checks for a successful scanner run today and sends "scanerul nu a rulat azi" if missing; `/health` shows the date of the last successful scan.

### 5.3 — On-demand `/analyze <home> <away>`

- Fixture resolution against upcoming fixtures (next 7 days) with the existing team matcher; ambiguous or unknown → short list of candidates.
- Fresh odds (option A, ≤ 2 h): one Odds API **event-odds** call for the fixture with all 6 markets (`h2h`, `totals`, `alternate_totals`, `btts`, `draw_no_bet`, `double_chance`). Cost to be measured on the first call (expected ≈ 6 credits). Gated by the existing on-demand cap (200/month) → about 30 analyses/month.
- Reuse: if the fixture already has an on-demand batch younger than 2 h, no new call is made (0 credits).
- Reply: `explainAnalysis` output (template numbers; Gemini commentary only if configured and validated); predictions recorded with `trigger = on_demand`.

### 5.4 — Settlement and backup

- **Settlement** (in the daily job, after results sync): for every unsettled prediction with a `FINISHED` fixture, write `prediction_outcomes` (`WIN`/`LOSS`/`PUSH`/`VOID`, paper profit per 1 unit; `INSUFFICIENT_DATA` rows are `VOID`). Postponed/cancelled → `VOID` after a grace period. `closing_odds_snapshot_id` stays null until closing odds are sourced (Phase 6, football-data.co.uk).
- **Backup (D-08)**: weekly GitHub Actions job exporting all tables as gzipped CSV, stored as a **private workflow artifact** (not Git), 90-day retention; restore tested once into a throwaway Postgres in the Actions runner.

## 3. Decisions requested from the Product Owner

| ID | Decision | Recommendation |
|---|---|---|
| D-14 | Approve this plan and the order 5.1 → 5.4, with a merge after each sub-phase | Approve |
| D-15 | Scanner as a second step in `daily-sync` (same run, same secrets) | Approve |
| D-16 | `/analyze` fetches all 6 markets in one event-odds call (≈ 6 credits, ≈ 30/month within the 200 cap) with 2 h reuse | Approve |
| D-17 | Store all 16 selections per analysed fixture, including `INSUFFICIENT_DATA` | Approve (estimated < 5 MB/season) |
| D-08 | Backup target: private GitHub Actions artifact, weekly, 90-day retention | Approve; Actions artifact storage quota for private repos to be verified |

## 4. Product Owner actions (when each sub-phase needs them)

- 5.2: add GitHub Actions secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` (same values as on Render). Claude never sees them.
- 5.3: add `ODDS_API_KEY` on Render (the bot fetches on-demand odds).

## 5. Known risks and limitations

- Only 39 odds events are linked to fixtures so far; linking quality decides how many fixtures can be analysed. 5.1 reports unlinked events explicitly.
- Early-season samples: many fixtures will be `INSUFFICIENT_DATA` until earlier seasons are loaded (open point from [19](19-session-handoff.md)).
- GitHub cron is best effort; the digest time is not guaranteed.
- Render free sleep: the first `/analyze` after idle adds about 5 s.
- All thresholds remain PROVISIONAL (D-06); QUALIFIED means eligible for paper tracking only.

## 6. Sub-phase 5.1 — implementation (2026-10-15)

| Deliverable | File |
|---|---|
| Migration 3: `model_versions`, `analysis_runs`, `predictions`, `prediction_outcomes`, `explanations`, `scan_digests`; append-only triggers, RLS | `supabase/migrations/20261015000003_predictions.sql` |
| DB assertions (append-only, one digest per day, one outcome per prediction, value status needs odds and EV, no future `as_of`) | `supabase/tests/predictions.test.sql` |
| Data access for the pipeline (fixtures, history, quotes through `odds_event_links`, runs, predictions) | `src/persistence/analysisStore.js` |
| Shared pipeline `analyzeFixture` (history → `estimate` → quotes → `evaluateFixture` → `explainAnalysis`) and `inputHash` | `src/pipeline/analyzeFixture.js` |
| `predictionRows` (16 rows per fixture) and `recordAnalysis` (skips identical inputs) | `src/pipeline/record.js` |
| Best quote now carries its `snapshotId` (exact quote stored in the prediction) | `src/domain/risk/evaluate.js` |

Design notes:
- History: the most recent 1,000 finished league matches before `asOf` (about 2.5 seasons; the model uses at most 380 league and 38 team matches). `estimate()` repeats the leakage guard.
- Quotes: pre-match snapshots of the last 24 h, found by `fixture_id` **or** through `odds_event_links`; freshness is decided by the risk engine (6 h scanner, 2 h on-demand).
- `input_hash` covers model and risk config hashes, λ, the data cutoff and, per selection, status, reasons and the exact quote. A run whose result is identical to the last recorded one for the fixture records nothing; any change records 16 new rows. Rows are never updated.
- The truncate assertion on `odds_snapshots` in `reference_and_odds.test.sql` now uses `cascade`: a plain `TRUNCATE` is refused earlier by the new foreign key from `predictions`, and the cascade form proves the append-only trigger still fires.

Verification: 151/151 unit tests, lint clean; all migrations and both DB test files pass on a local PostgreSQL 16 (CI uses 17). Read-only check of the live database: in the next 7 days, every BUNDESLIGA, LALIGA, SERIEA and LIGUE1 fixture has linked odds; EPL has none yet (no EPL match within the 48 h odds horizon at the last sync). League history: 349–458 finished matches per league.

CI run 38714801774 green (test + db jobs). Merge into `main` and migration 3 approved by the PO on 2026-10-15. `main` fast-forwarded to `561cb77`; migration 3 applied to Supabase `fvis` (RLS on all 6 new tables, no anon access, 2 append-only triggers on each of the 5 append-only tables; advisor: only the expected INFO "RLS enabled, no policy").

Not yet done: no end-to-end run against live data, since the service-role key is only available in GitHub Actions and on Render (first live run is the 5.2 scanner).

## 7. Sub-phase 5.2 — implementation (2026-10-15)

| Deliverable | File |
|---|---|
| Scanner job: domestic fixtures in the next 48 h → `analyzeFixture` (scanner mode, D-11 markets) → `recordAnalysis` → digest → Telegram | `src/jobs/scan.js`, `scripts/scan.js` |
| Digest text (Romanian; numbers only from `buildFacts`; QUALIFIED then WATCHLIST by EV, max 25 each; coverage, credits, disclaimer) | `src/telegram/digest.js` |
| Bot API sender for jobs (plain text, split under 4,096 chars, 3 attempts on 5xx/429/network, token redacted) | `src/telegram/send.js` |
| Missed-run watchdog (alert if no OK/PARTIAL scanner run for today, Europe/Bucharest) | `scanWatchdog` in `src/jobs/scan.js`, `scripts/scan-watchdog.js`, `.github/workflows/scan-watchdog.yml` (10:17 UTC) |
| Workflow: `Scan` step after `Sync` in `daily-sync` (runs even if a competition failed to sync); manual input `scan_only` skips the sync (0 credits) | `.github/workflows/daily-sync.yml` |
| Bot: `/scan` re-sends the latest stored digest (no re-run, no credits); `/health` shows the last finished scanner run | `src/telegram/bot.js`, `src/telegram/messages.js`, `src/persistence/queries.js` |

Idempotency: every run records an `analysis_runs` row and new predictions only where inputs changed. The digest row (primary key `scan_date`) is inserted **before** sending; a second run the same day, or a run that loses the race, finds the row and sends nothing. If Telegram fails, the run is `PARTIAL`, the digest stays stored and `/scan` re-sends it; the watchdog counts `PARTIAL` as "ran".

Gemini is not used by the scanner (template numbers only); it stays limited to `/analyze` (5.3).

Verification: 164/164 tests, lint clean. Tests cover one digest per day across duplicated runs, a lost claim race, Telegram failure (`PARTIAL`, digest kept), empty horizon, a failing fixture, watchdog alert/no alert, message splitting, sender retry and token redaction, Bucharest scan date across midnight, `/scan` and `/health`.

### 5.2 live verification (2026-10-15, run 38716520794, `scan_only`, 0 credits)

- Scanner: 4 fixtures in the 48 h horizon (Friday matches), 4 analysed, 4 recorded → 64 predictions (4 QUALIFIED, 6 WATCHLIST, 14 NO_VALUE, 40 INSUFFICIENT_DATA, mostly `ODDS_NOT_FETCHED` per D-11); digest stored (2,412 chars); 1 model version registered.
- Telegram send failed with **HTTP 401** (bot token rejected) → run `PARTIAL`, as designed. Cause is the GitHub secret `TELEGRAM_BOT_TOKEN`; Render's token works. Follow-up: the sender now trims the token, checks its format and names the cause on 401/403. The PO corrected the secret; a test message sent from Actions (`scan-watchdog`, input `send_test`) was received.
- **Quantitative observation:** 3 of the 4 QUALIFIED selections involve promoted teams with only 6–8 current-season matches (Deportivo, Le Mans, Frosinone). This follows the approved spec (`nTeamMin = 5`, shrinkage `k = 8`, promoted prior disabled; docs/04 §8), but such estimates are the least reliable. Decision requested from the PO (D-18).

### D-18 implementation (risk rules 1.1.0)

`TEAM_SAMPLE_SMALL` qualification gate in `src/domain/risk/evaluate.js`: if `n_H` or `n_A` (team matches in the model window, from the estimate diagnostics) is below `minTeamMatchesQualify` = 10 (PROVISIONAL), a positive-EV selection is at most WATCHLIST. The model and its outputs are unchanged; predictions are still recorded. The new risk config hash changes `input_hash`, so the next scan records a fresh set for every fixture. Applied to the first live scan, the three promoted-team QUALIFIED selections (n = 6–8) would be WATCHLIST; Frankfurt – Köln (38/38) stays QUALIFIED.

## 8. Sub-phase 5.3 — implementation (2026-10-15)

| Deliverable | File |
|---|---|
| `/analyze <home> - <away>` (also "vs", or two single words; one name lists that team's matches) | `src/telegram/bot.js`, `src/pipeline/onDemand.js` |
| Match resolution over domestic fixtures in the next 7 days with the shared team matcher (all known names: canonical, short, provider); ambiguous → list, unknown → message; never guessed | `resolveMatch` in `src/pipeline/onDemand.js`, `teamAliases` in `src/persistence/analysisStore.js` |
| Fresh odds (option A, D-16): one event-odds call with `h2h, totals, alternate_totals, btts, draw_no_bet, double_chance`, `purpose = on_demand` (credit cap 200); reuse when an on-demand batch younger than 2 h exists; unlinked fixtures are linked through the free events list; concurrent requests for one fixture share one fetch | `refreshOdds`, `ensureEventId` |
| Same pipeline as the scanner: `analyzeFixture` in mode `on_demand`, Gemini commentary when `GEMINI_API_KEY` + `GEMINI_MODEL_ID` are set (validated, template fallback), run + predictions + explanation recorded | `src/pipeline/onDemand.js`, `src/server.js` |
| D-19 option A: UCL/UEL matches → market-only view (mean of complete per-bookmaker de-vigged sets for 1X2 and O/U 2.5); also a cup section in the daily digest. No model, no EV, no status, nothing recorded, no extra credits | `src/domain/odds/consensus.js`, `src/telegram/marketView.js`, `src/jobs/scan.js`, `src/telegram/digest.js` |
| Config exposes `ODDS_API_KEY` (optional) and Gemini settings; on-demand odds requests are written to `provider_request_log` | `src/config/index.js`, `src/server.js` |

Failure behaviour: credit cap reached, provider error or missing `ODDS_API_KEY` → the analysis still runs on the odds already stored and the reply says why the odds were not refreshed (stale or not-fetched markets become `INSUFFICIENT_DATA` by the risk rules).

Verification: 178/178 tests, lint clean. New tests: query parsing (including two-word team names), one fetch with all six markets, link creation, reuse within 2 h, refetch after 2 h, double tap, reversed order, single team, unknown match, missing key, credit cap, cup market view (no predictions, no credits), consensus maths, digest cup section, `/analyze` argument passing and message splitting.

PO actions before the live test: add `ODDS_API_KEY` on Render (same value as the GitHub secret); `GEMINI_API_KEY` and `GEMINI_MODEL_ID` optional.

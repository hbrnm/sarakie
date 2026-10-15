# 20 — Phase 5 Plan: Scanner and Prediction Tracking

Status: **PROPOSED** (2026-10-15). Phase 5 start requested by the Product Owner; this plan needs PO approval before any code is written (`CLAUDE.md` §12).

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

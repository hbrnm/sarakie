# 19 — Session Handoff (2026-10-15)

Starting point for the next session (Phase 5). Read `CLAUDE.md` first; verify everything below against the repository and services before relying on it (§12).

## State

| Phase | Status | Key documents |
|---|---|---|
| 0 Foundation | complete | `docs/00`–`13` |
| 1 Telegram + Render | complete; cold start ≈ 5 s | `docs/15` |
| 2 Data integration | complete | `docs/14`, `docs/16` |
| 3 Quantitative engine | complete (Poisson v1.0.0) | `docs/04`, `docs/17` |
| 4 Risk + explanations | complete (risk v1.0.0) | `docs/06`, `docs/18` |
| 5 Scanner + tracking | **next — requires PO approval at session start** | `docs/10`, `docs/11` |

## Running infrastructure

- **Render** web service `fvis-bot` (free, Frankfurt), auto-deploy from `main`. Env: Telegram vars, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `GEMINI_API_KEY`/`GEMINI_MODEL_ID` being added by the PO.
- **Supabase** project `fvis`, ref `tqelifzgatxkdzifbyhr`, organization "atlasculinar" (free, eu-central-1). Migrations 1–2 applied. A stray unused project `fvis` (ref `oyfznftillyxhsaxaxnw`, org "Camara") exists in another account.
- **GitHub Actions**: `ci` (lint, tests, audit, DB assertions); `daily-sync` (cron `17 7 * * *` UTC); manual `backfill-history`, `adapter-smoke`, spike probes. Secrets: `FOOTBALL_DATA_ORG_KEY`, `ODDS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Odds credits**: 447 of 500 remaining for October after the first daily sync; ~10 credits per daily run.

## Code map

- Providers: `src/providers/{footballDataOrg,oddsApi,footballDataCoUk}`; credit budget `src/providers/oddsApi/creditBudget.js`.
- Persistence: `src/persistence/{supabase,repositories,queries}.js`.
- Jobs: `src/jobs/{backfillHistory,dailySync}.js`, entry points in `scripts/`.
- Model: `src/domain/model/estimate.js` (pure; `asOf` leakage guard).
- Risk: `src/domain/risk/evaluate.js` (modes `scanner` / `on_demand`).
- Explanations: `src/explain/index.js` (`explainAnalysis`), Gemini optional.
- Bot: `src/telegram/{bot,messages}.js`; commands `/start /help /health /fixtures /quota`.

## Phase 5 scope (from the roadmap) and known prerequisites

1. `pipeline/analyzeFixture`: load history (DB) → `estimate` → load odds (resolve fixtures through **`odds_event_links`**, not only `odds_snapshots.fixture_id`) → `evaluateFixture` → `explainAnalysis`.
2. Predictions table (append-only migration) per `docs/05`; persist every evaluated selection with model/risk versions and config hashes.
3. Scanner: run after `daily-sync`, Telegram digest of QUALIFIED/WATCHLIST, missed-run detection.
4. `/analyze <home> <away>`: fixture resolution (ambiguity → list), fresh event odds for the fixture (option A, on-demand credit cap 200), full message.
5. Outcome settlement into `prediction_outcomes`; backup job (D-08 still deferred).

Open points carried forward:
- Load earlier seasons from football-data.co.uk to reduce `INSUFFICIENT_DATA` early in a season (recommended for Phase 6, maybe useful earlier).
- Confirm monthly odds-credit consumption after ~2 weeks of daily runs.
- Ligue 1 2025: one match not reported as finished by football-data.org.
- Daily cron moves to 09:17 Bucharest after 25 Oct (UTC schedule).

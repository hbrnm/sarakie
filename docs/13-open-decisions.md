# 13 — Open Decisions

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| D-00 | Documentation language | English | **APPROVED** 2026-10-15 |
| D-00b | Repository visibility | Private | **CONFIRMED** by PO 2026-10-15 |
| D-01 | Run a provider feasibility spike (Phase 2a) before Phase 1 | Yes. It resolves the blocking risk on API-Football free-plan seasons and odds | **APPROVED** 2026-10-15 |
| D-02 | Fallback plan if the API-Football free plan cannot serve current-season data | Evaluate free supplementary sources (S-50 results, S-52 odds) before considering any paid tier | **APPROVED** 2026-10-15: option 1 (free-source combination); Phase 2b probe to confirm |
| D-03 | Scanner execution location | Option A: run inside GitHub Actions ([02 §2.1](02-architecture.md)) | **APPROVED** 2026-10-15 |
| D-04 | Telegram bot message language | Romanian (technical identifiers in English) | **APPROVED** 2026-10-15 |
| D-05 | Gemini on free tier given data-use terms and possible EEA restriction (S-40, S-42) | Keep Gemini optional; verify EEA availability before Phase 4; template fallback mandatory | **APPROVED** 2026-10-15 (Gemini optional; EEA availability to verify before Phase 4) |
| D-06 | Provisional parameter starting values in [04 §14](04-quantitative-model-spec.md) and [06](06-risk-policy.md) | Accept as provisional starting values, explicitly unvalidated, to be tuned in Phase 6 | **APPROVED** 2026-10-15 |
| D-07 | Node version / test runner / validation lib (ADR-012, ADR-014) | Node 22 LTS, `node:test`, Zod | **APPROVED** 2026-10-15 |
| D-08 | Backup target for weekly DB export | Decide in Phase 5 | DEFERRED |
| D-09 | Merge `docs/phase-0-foundation` into `main` | After PO review of the Phase 0 docs | **APPROVED** 2026-10-15 |
| D-10 | Replace API-Football with football-data.org (fixtures/results) + The Odds API (odds) + football-data.co.uk (history/closing). Env vars `FOOTBALL_DATA_ORG_KEY`, `ODDS_API_KEY` replace `API_FOOTBALL_KEY` in `CLAUDE.md` §3/§9 | Approve (evidence: [14](14-data-source-feasibility-results.md)) | **APPROVED** 2026-10-15 |
| D-11 | Market coverage under the 500 credits/month odds quota | Scanner: 1X2 + O/U main line for all matches, on days with fixtures in the next 48 h. DC, DNB, BTTS, O/U 1.5/3.5: on-demand only, within a monthly cap of about 200 credits plus a reserve. Reported as `INSUFFICIENT_DATA` (`ODDS_NOT_FETCHED`) otherwise | **APPROVED** 2026-10-15 |
| D-12 | Start Phase 1 (Telegram and cloud skeleton) | Approve once D-10 and D-11 are decided | **APPROVED** 2026-10-15 |
| D-13 | Add UEFA Champions League and Europa League (PO request 2026-10-15) | See recommendation in [14 §5](14-data-source-feasibility-results.md#5-uefa-champions-league-and-europa-league-request-2026-10-15) | OPEN |

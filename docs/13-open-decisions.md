# 13 — Open Decisions

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| D-00 | Documentation language | English | **APPROVED** 2026-10-15 |
| D-00b | Repository visibility | Private | **CONFIRMED** by PO 2026-10-15 |
| D-01 | Run a provider feasibility spike (Phase 2a) before Phase 1 | Yes. It resolves the blocking risk on API-Football free-plan seasons and odds | **APPROVED** 2026-10-15 |
| D-02 | Fallback plan if the API-Football free plan cannot serve current-season data | Evaluate free supplementary sources (S-50 results, S-52 odds) before considering any paid tier | OPEN (depends on D-01 outcome) |
| D-03 | Scanner execution location | Option A: run inside GitHub Actions ([02 §2.1](02-architecture.md)) | **APPROVED** 2026-10-15 |
| D-04 | Telegram bot message language | Romanian (technical identifiers in English) | **APPROVED** 2026-10-15 |
| D-05 | Gemini on free tier given data-use terms and possible EEA restriction (S-40, S-42) | Keep Gemini optional; verify EEA availability before Phase 4; template fallback mandatory | **APPROVED** 2026-10-15 (Gemini optional; EEA availability to verify before Phase 4) |
| D-06 | Provisional parameter starting values in [04 §14](04-quantitative-model-spec.md) and [06](06-risk-policy.md) | Accept as provisional starting values, explicitly unvalidated, to be tuned in Phase 6 | **APPROVED** 2026-10-15 |
| D-07 | Node version / test runner / validation lib (ADR-012, ADR-014) | Node 22 LTS, `node:test`, Zod | **APPROVED** 2026-10-15 |
| D-08 | Backup target for weekly DB export | Decide in Phase 5 | DEFERRED |
| D-09 | Merge `docs/phase-0-foundation` into `main` | After PO review of the Phase 0 docs | **APPROVED** 2026-10-15 |

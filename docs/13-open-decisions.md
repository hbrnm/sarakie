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
| D-08 | Backup target for weekly DB export | Weekly gzipped CSV export as a private GitHub Actions artifact, 90-day retention ([20](20-phase-5-plan.md)) | **APPROVED** 2026-10-15 |
| D-09 | Merge `docs/phase-0-foundation` into `main` | After PO review of the Phase 0 docs | **APPROVED** 2026-10-15 |
| D-10 | Replace API-Football with football-data.org (fixtures/results) + The Odds API (odds) + football-data.co.uk (history/closing). Env vars `FOOTBALL_DATA_ORG_KEY`, `ODDS_API_KEY` replace `API_FOOTBALL_KEY` in `CLAUDE.md` §3/§9 | Approve (evidence: [14](14-data-source-feasibility-results.md)) | **APPROVED** 2026-10-15 |
| D-11 | Market coverage under the 500 credits/month odds quota | Scanner: 1X2 + O/U main line for all matches, on days with fixtures in the next 48 h. DC, DNB, BTTS, O/U 1.5/3.5: on-demand only, within a monthly cap of about 200 credits plus a reserve. Reported as `INSUFFICIENT_DATA` (`ODDS_NOT_FETCHED`) otherwise | **APPROVED** 2026-10-15 |
| D-12 | Start Phase 1 (Telegram and cloud skeleton) | Approve once D-10 and D-11 are decided | **APPROVED** 2026-10-15 |
| D-13 | Add UEFA Champions League and Europa League (PO request 2026-10-15) | Two steps: (1) Phase 2: UCL/UEL fixtures and odds shown for information only, model output `INSUFFICIENT_DATA` (`MODEL_NOT_APPLICABLE_CROSS_LEAGUE`); (2) Phase 6: cross-league extension, enabled only if backtests support it. See [14 §5](14-data-source-feasibility-results.md#5-uefa-champions-league-and-europa-league-request-2026-10-15) | **APPROVED** 2026-10-15 |
| D-14 | Phase 5 plan and order 5.1 → 5.4, merge after each sub-phase ([20](20-phase-5-plan.md)) | Approve | **APPROVED** 2026-10-15 |
| D-15 | Scanner as a second step of the `daily-sync` workflow | Approve | **APPROVED** 2026-10-15 |
| D-16 | `/analyze`: one event-odds call with all 6 markets, 2 h reuse, within the 200-credit on-demand cap | Approve | **APPROVED** 2026-10-15 |
| D-17 | Record all 16 selections per analysed fixture, including `INSUFFICIENT_DATA` | Approve | **APPROVED** 2026-10-15 |
| D-18 | Promoted / short-history teams (3 of 4 QUALIFIED in the first live scan had 6–8 matches) | Option A: qualification gate `TEAM_SAMPLE_SMALL` — a team with fewer than 10 matches in its window caps the selection at WATCHLIST (PROVISIONAL threshold); predictions still recorded | **APPROVED** 2026-10-15 |
| D-19 | Analysis of UCL/UEL matches (PO request 2026-10-15) | Option A now: market-only view for cup matches in the digest and `/analyze` (consensus de-vigged probabilities, no model, no EV/QUALIFIED, 0 extra credits). Option B (cross-league model extension) stays in Phase 6 | **APPROVED** 2026-10-15 (option A) |
| D-20 | PO request: analyse everything played today and give tips | FVIS gives no tips (CLAUDE.md §1, §4.1, §7). Instead `/azi` (`/azi maine`): one message with every match of the Bucharest calendar day — latest stored FVIS analysis for league matches (QUALIFIED/WATCHLIST with odds, model probability, EV; otherwise no value / insufficient data / not analysed), market-only view for UCL/UEL (D-19); 0 credits | **APPROVED** 2026-10-15 |
| D-21 | Apply FVIS to UCL/UEL (PO request) | Phase 6a feasibility study first: verify free data sources (club Elo, extra domestic leagues, historical UEFA results), measure coverage of current UCL/UEL teams, recommend a model approach; measurement only | **APPROVED** 2026-10-15 |

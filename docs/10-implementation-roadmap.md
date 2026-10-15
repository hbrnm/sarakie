# 10 — Implementation Roadmap

Every phase starts only after explicit Product Owner approval (`CLAUDE.md` §11). Each phase ends with a handoff: changed files, verification, limitations, unresolved issues, recommended next phase.

| Phase | Goal | Key deliverables | Depends on |
|---|---|---|---|
| **0** | Foundation | This documentation set, `CLAUDE.md`, `.env.example`, `.gitignore` | — |
| **2a (proposed early)** | Provider feasibility spike | Measured answers to S-01…S-08 using a free key. No production code, only a throwaway script or manual calls documented in `08` | D-01 |
| **1** | Telegram + cloud skeleton | `package.json`, config validation, Telegraf webhook bot with allowlist, `/start` `/help` `/health`, Render deploy, CI (lint + `node:test` + `npm audit`) | Phase 0 approval |
| **2** | Football data integration | Provider adapter, league discovery, team/fixture normalization, odds normalization, quota guard, DB migrations for reference tables, `/quota` | 2a outcome |
| **3** | Quantitative engine | `domain/model`, `domain/markets`, `domain/odds` + all tests in [04 §15](04-quantitative-model-spec.md) | Phase 2 data shapes |
| **4** | Risk engine + explanations | `domain/risk`, reason codes, Gemini client, output validator, template fallback | Phase 3 |
| **5** | Scanner + tracking | `pipeline/analyzeFixture`, `jobs/scan.js`, GitHub Actions workflow, `/analyze`, `/fixtures`, `/scan`, append-only triggers, outcome settlement, backup job | Phase 4 |
| **6** | Validation + research | Backtest harness, calibration, OOS evaluation, parameter tuning (`k`, windows, thresholds), Dixon-Coles evaluation decision | ≥ 1 season of history; Phase 5 for live paper tracking |

## Recommended sequencing change

**RECOMMENDATION:** run a short **provider feasibility spike (2a) before Phase 1**. The blocking risk (free-plan season access, odds coverage) determines whether the approved stack works at zero budget at all. Building the Telegram skeleton first is cheap but would not reduce this risk. The spike needs only a free API key registered by the Product Owner; Claude never sees the key, and the PO runs the calls or stores the key as a GitHub/Render secret.

## Out-of-roadmap items (need separate approval)

- Additional leagues or markets (Asian handicap, corners, cards).
- Public dashboard.
- Paid tiers of any service.

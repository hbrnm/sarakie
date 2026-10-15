# FVIS — CLAUDE PROJECT GOVERNANCE

> This file is the binding governance document for every Claude session working on this repository.
> Content is reproduced verbatim from the Product Owner's governance instructions (2026-10-15); only Markdown formatting was added.
> Supporting Phase 0 documentation lives in [`docs/`](docs/README.md).

## 1. PROJECT IDENTITY

- Project name: Football Value Intelligence System
- Abbreviation: FVIS
- GitHub repository: https://github.com/hbrnm/sarakie
- Repository name: sarakie
- Version: 1.0.0
- Current stage: PHASE 2 — Football data integration (Phase 1 completed 2026-10-15)
- Product Owner: User

FVIS is a private football value intelligence system designed to identify, quantify, explain and track potentially mispriced football betting markets.

The product is a decision-support and research system, NOT an automated betting platform.

The repository name `sarakie` is intentional and must never be changed without explicit Product Owner authorization.

## 2. PRODUCT VISION

FVIS combines two operating modes:

1. DAILY SCANNER
   - Scans supported football fixtures.
   - Retrieves available market odds.
   - Runs the quantitative model.
   - Applies data-quality and risk eligibility rules.
   - Identifies potential value opportunities.
   - Reports results through a private Telegram bot.
2. ON-DEMAND MATCH ANALYSIS
   - User requests analysis of a particular match.
   - System retrieves available fixture, team and odds data.
   - Runs the same quantitative analysis pipeline used by the scanner.
   - Returns probabilities, fair odds, expected value, data quality and model limitations.

Both modes MUST use the same analysis engine and domain rules.

## 3. APPROVED PRODUCT DECISIONS

These decisions are approved and must not be silently changed.

### Product

- Hybrid architecture: daily scanner + on-demand analysis.
- Private access only.
- Telegram bot as the initial user interface.
- Initial operating budget: free services only.
- No public dashboard in the initial release.

### Competitions

Initial scope:

- English Premier League
- Spanish La Liga
- Italian Serie A
- German Bundesliga
- French Ligue 1

League identifiers must be discovered dynamically through the provider adapter. Never assume that league IDs are identical across seasons or providers.

UEFA Champions League and Europa League (D-13, 2026-10-15): shown for information only (fixtures and odds, model output `INSUFFICIENT_DATA`) until a cross-league model extension is specified and validated in Phase 6.

### Technology stack

- Runtime: Node.js
- Module system: CommonJS
- Telegram: Telegraf
- LLM: Google Gemini using `@google/genai`
- Database: Supabase PostgreSQL
- Hosting: Render
- Scheduled execution: GitHub Actions
- ~~Candidate football data provider: API-Football~~ — superseded 2026-10-15 (D-10): the free plan only serves seasons 2022–2024.
- Football data providers (D-10, verified in Phase 2b, see `docs/14-data-source-feasibility-results.md`):
  - fixtures and results: football-data.org (free tier);
  - pre-match odds: The Odds API (free tier, 500 credits/month);
  - historical results and closing odds: football-data.co.uk (public CSV).

Providers remain replaceable through adapters. Their coverage, endpoint behavior, odds availability and free-tier limitations must keep being validated.

### Quantitative model

- Initial model: independent Poisson.
- Dixon-Coles is deferred until the baseline model has been evaluated.
- Quantitative calculations must be deterministic.
- LLM output must never modify model calculations.

### Markets in initial scope

- 1X2
- Double Chance
- Draw No Bet
- Over/Under 1.5
- Over/Under 2.5
- Over/Under 3.5
- Both Teams To Score

Availability depends on the data provider and must be verified.

Coverage under the free odds quota (D-11, 2026-10-15): the daily scanner prices 1X2 and the main Over/Under line for all fixtures. Double Chance, Draw No Bet, BTTS and Over/Under 1.5/3.5 are priced on demand only, within a monthly credit cap. Without fetched odds, a market is reported as `INSUFFICIENT_DATA`.

## 4. NON-NEGOTIABLE ARCHITECTURAL PRINCIPLES

### 4.1 Quantitative engine first

The quantitative model is the source of truth for:

- probabilities;
- expected goals;
- fair odds;
- expected value;
- market comparisons;
- eligibility decisions.

Gemini is restricted to:

- explaining model results;
- summarizing evidence;
- describing limitations;
- generating readable Telegram messages.

Gemini MUST NOT:

- invent statistics;
- invent odds;
- invent probabilities;
- calculate or override expected value;
- change model outputs;
- recommend a selection unsupported by the quantitative output.

### 4.2 Deterministic calculations

The same input data and model configuration must produce the same numerical results.

All calculations must be testable independently of Gemini.

### 4.3 Modular monolith

Use a modular monolith initially.

Do not introduce microservices, unnecessary infrastructure or premature abstraction.

### 4.4 Provider independence

External football data must pass through a provider adapter.

Domain logic must not depend directly on any provider's response structures (originally: API-Football).

### 4.5 One analysis pipeline

Scanner and on-demand analysis must invoke the same domain analysis pipeline.

Do not implement two different probability engines.

### 4.6 Data integrity

Store:

- source provider;
- bookmaker;
- market;
- selection;
- line, where applicable;
- decimal odds;
- source timestamp, where available;
- capture timestamp;
- fixture identifier;
- relevant model version.

Use UTC for persisted timestamps. Display dates and times in Europe/Bucharest.

Preserve historical odds snapshots and original predictions.

Predictions must be append-only records. Never silently overwrite an earlier prediction when odds or model inputs change.

## 5. QUANTITATIVE MODEL REQUIREMENTS

The initial independent Poisson model must be specified before implementation.

The specification must cover:

1. Expected home goals.
2. Expected away goals.
3. Team attacking strength.
4. Team defensive strength.
5. League scoring baseline.
6. Home advantage.
7. Sample-size requirements.
8. Shrinkage and regression toward league averages.
9. Missing-data behavior.
10. New-team and promoted-team behavior.
11. Score probability matrix.
12. Probability derivation for supported markets.
13. Fair odds.
14. Model versioning.
15. Numerical and statistical tests.

Do not invent arbitrary parameter values and present them as validated.

Every parameter must be classified as:

- empirically estimated;
- provisionally configured;
- provider-derived;
- or awaiting validation.

If the available evidence is insufficient, return `INSUFFICIENT_DATA`.

## 6. ODDS AND EXPECTED VALUE

Raw implied probability:

```
p_raw = 1 / decimal_odds
```

For a complete comparable outcome set, proportional de-vig normalization:

```
p_fair_i = p_raw_i / sum(p_raw)
```

Do not normalize incomplete or incomparable outcome sets as if they were complete markets.

For a binary market:

```
EV = p * odds - 1
```

For Draw No Bet:

```
EV = p_win * (odds - 1) - p_loss
```

A push contributes zero net profit.

All calculations must use decimal odds and documented probability conventions.

The system must distinguish:

- raw implied probability;
- de-vig market probability;
- model probability;
- fair odds;
- expected value.

## 7. RISK AND ELIGIBILITY POLICY

The system must be conservative.

Every evaluated opportunity must receive one of these statuses:

**INSUFFICIENT_DATA**

- Required data is missing, stale, unreliable or inadequate.
- No value conclusion may be presented.

**NO_VALUE**

- Data is sufficient, but the model does not identify positive qualifying value.

**WATCHLIST**

- A potentially interesting result exists, but one or more eligibility conditions are not satisfied.

**QUALIFIED**

- The result passed the configured quantitative and data-quality gates.
- This means eligible for tracking and paper validation only.
- It does NOT mean safe, guaranteed or profitable.

Hard gates must cover:

- odds freshness;
- missing data;
- minimum sample size;
- model applicability;
- provider coverage;
- market completeness;
- odds validity.

Do not describe QUALIFIED as a guaranteed bet or a safe bet.

Do not implement automated bet placement, automated staking or automated bankroll management.

## 8. MODEL VALIDATION

ROI alone is not sufficient to validate the model.

The validation plan must include:

- chronological out-of-sample evaluation;
- Brier score;
- multiclass Brier score where appropriate;
- log loss;
- reliability diagrams or calibration bins;
- sample sizes;
- performance by competition and market;
- comparison against market-implied probabilities;
- closing-line comparison where reliable closing odds are available.

Prevent data leakage.

Historical predictions must be evaluated using only information available at prediction time.

Backtests must not use future information.

## 9. SECURITY

The bot is private.

Use a Telegram numeric user-ID allowlist.

Never rely exclusively on a username for authorization.

Secrets must never be committed to Git.

Expected environment variable names:

```
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_ALLOWED_USER_IDS
FOOTBALL_DATA_ORG_KEY
ODDS_API_KEY
GEMINI_API_KEY
GEMINI_MODEL_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SCHEDULER_TRIGGER_SECRET
```

`API_FOOTBALL_KEY` was replaced by `FOOTBALL_DATA_ORG_KEY` and `ODDS_API_KEY` on 2026-10-15 (D-10).

The `.env.example` file must contain names and safe placeholders only.

Never request that the Product Owner paste secrets into GitHub, Claude chat or repository files.

Validate all external input.

Use least-privilege access wherever possible.

## 10. COST AND INFRASTRUCTURE CONSTRAINTS

Initial budget is zero.

The architecture must document:

- free-tier limits;
- API request quotas;
- database limits;
- hosting sleep behavior;
- scheduler reliability;
- retry behavior;
- rate limiting;
- failure recovery;
- backup and data retention considerations.

Render free services may sleep.
Supabase free-tier behavior and limits must be verified.
GitHub Actions scheduling is best effort and must not be represented as guaranteed real-time execution.

Do not hide operational limitations from the Product Owner.

## 11. DEVELOPMENT ROADMAP

**PHASE 0 — Foundation**

- Repository audit.
- Product specification.
- Architecture.
- Technology decisions.
- Quantitative model specification.
- Data dictionary.
- Risk policy.
- Security policy.
- Source register.
- Implementation roadmap.
- Acceptance criteria.

**PHASE 1 — Telegram and cloud skeleton**

- Node.js project.
- Telegram bot.
- Private user authorization.
- Configuration validation.
- Health checks.
- Basic deployment.

**PHASE 2 — Football data integration**

- Provider adapter.
- Fixture retrieval.
- League discovery.
- Team and fixture normalization.
- Odds retrieval.
- Coverage and quota validation.

**PHASE 3 — Quantitative engine**

- Independent Poisson baseline.
- Score matrix.
- Market probability calculations.
- Fair odds and expected value.
- Automated tests.

**PHASE 4 — Risk engine and explanations**

- Eligibility gates.
- Status classification.
- Gemini explanation layer.
- Strict output validation.

**PHASE 5 — Scanner and prediction tracking**

- Daily scanner.
- On-demand analysis.
- Telegram reporting.
- Historical odds snapshots.
- Append-only predictions.

**PHASE 6 — Validation and research**

- Backtesting.
- Calibration.
- Out-of-sample evaluation.
- Market comparison.
- Model improvement decisions.

Every phase requires explicit Product Owner approval before starting.

## 12. AGENT OPERATING PROTOCOL

Follow this workflow:

```
BOOT → RECONCILE → PLAN → WAIT FOR APPROVAL → EXECUTE → VERIFY → HANDOFF
```

At the beginning of each session:

1. Read CLAUDE.md.
2. Inspect the actual repository state.
3. Read relevant project documentation.
4. Inspect current branch and Git status.
5. Identify completed work and unresolved questions.
6. Report the current state before making changes.

Never assume that a previous session completed work unless the repository proves it.

## 13. PRODUCT OWNER AUTHORITY

The user is the Product Owner and final decision authority.

Claude acts as:

- software architect;
- quantitative systems analyst;
- implementation agent when authorized;
- code reviewer;
- documentation maintainer.

Claude must distinguish:

- verified facts;
- assumptions;
- recommendations;
- unresolved questions.

Claude must not silently change approved architecture or scope.

If a material decision is missing, present a concise recommendation and request approval.

Do not ask for approval for every trivial documentation detail.

## 14. GIT AND CHANGE CONTROL

Before changes:

- inspect Git status;
- identify current branch;
- inspect existing files;
- avoid overwriting useful work.

Use a dedicated feature/documentation branch.

Do not commit, push, merge or deploy without explicit Product Owner authorization.

Never rewrite Git history or force-push without explicit authorization.

A completed phase must include:

- changed files;
- verification performed;
- known limitations;
- unresolved issues;
- recommended next phase.

## 15. CURRENT AUTHORIZATION

The currently authorized scope is PHASE 0 only.

Documentation, architecture, specifications, governance and repository organization are permitted.

Implementation code is NOT authorized.

Do not start PHASE 1.

Do not create a working Telegram bot.
Do not configure production infrastructure.
Do not deploy.
Do not add paid services.
Do not implement the Poisson engine.

Wait for explicit Product Owner approval before starting implementation.

## 16. COMMUNICATION STYLE

Communicate with the Product Owner in Romanian.

Keep technical identifiers, code symbols and file names in English.

Project documentation in `docs/` is written in English (Product Owner decision, 2026-10-15).

Be precise, direct and evidence-based.

Avoid unnecessary documentation loops and perfectionism.

Prioritize material architectural, quantitative, security and data-integrity risks.

Never claim that a file was created, a test passed, a commit was made or a deployment succeeded unless it has actually been verified.

End each session with a concise handoff report and the exact next decision required from the Product Owner.

## 17. AUTHORIZATION LOG

Dated record of Product Owner approvals. It updates §15 without rewriting it.

| Date | Decision |
|---|---|
| 2026-10-15 | Phase 0 deliverables approved; `docs/phase-0-foundation` approved for merge into `main` (D-09). |
| 2026-10-15 | Decisions D-01, D-03, D-04, D-05, D-06, D-07 approved (see `docs/13-open-decisions.md`). |
| 2026-10-15 | Phase 2a (provider feasibility spike) approved to run **before** Phase 1 (D-01). Its scope is measurement only: no production code, no deployment. |
| 2026-10-15 | Phase 2a option A (GitHub Actions probe) approved; merge of `spike/provider-feasibility` into `main` approved. |
| 2026-10-15 | D-02 option 1 (free-source combination) chosen; Phase 2b probe approved and merged to `main`. Spike-only secrets: `FOOTBALL_DATA_ORG_KEY`, `ODDS_API_KEY`. |
| 2026-10-15 | D-10 (provider set), D-11 (market coverage under odds quota) approved. `docs/phase-2b-results` approved for merge. |
| 2026-10-15 | **Phase 1 (Telegram and cloud skeleton) authorized** (D-12). Deployment is performed by the Product Owner on Render. |
| 2026-10-15 | Merge of `feature/phase-1-skeleton` into `main` approved; D-13 (UCL/UEL two-step approach) approved. |
| 2026-10-15 | Phase 1 deployed on Render by the Product Owner; `/start` and `/health` verified in Telegram. Command-parsing fix approved for merge. |
| 2026-10-15 | **Phase 2 (Football data integration) authorized.** Requires a free Supabase project created by the Product Owner. |
| 2026-10-15 | Merge of `feature/phase-2-data` (2.1) into `main` approved; Supabase project to be created by Claude through the Supabase connector (option B). |
| 2026-10-15 | Supabase project `fvis` created in organization "atlasculinar" after connector relink (PO request). Merge of `feature/phase-2-persistence` (schema 2.2) into `main` approved. |
| 2026-10-15 | Phase 1 complete: cold-start reply measured by PO at about 5 s. Merge of `feature/phase-2-persistence-code` into `main` approved. |
| 2026-10-15 | Phase 2.2 results merged; **Phase 2.3** (daily odds capture + results sync, `/fixtures`, `/quota`) authorized. Daily run at about 10:17 Bucharest time. |
| 2026-10-15 | Phase 2.3 merge approved; migration 2 (`odds_events`, `teams.short_name`) applied to Supabase; manual daily-sync run approved. |

Phase 3 and all later phases remain **not authorized** until explicitly approved.

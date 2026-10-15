# 03 — Technology Decisions (ADR Log)

Status values: `APPROVED` (Product Owner), `CANDIDATE` (approved for evaluation, not final), `PROPOSED` (Claude recommendation awaiting approval).

| ID | Decision | Status | Notes |
|---|---|---|---|
| ADR-001 | Modular monolith | APPROVED | `CLAUDE.md` §4.3 |
| ADR-002 | Node.js runtime, CommonJS | APPROVED | Node 22 LTS (see ADR-012) |
| ADR-003 | Telegram via Telegraf, webhook mode | APPROVED | Long polling needs an always-on process, which is incompatible with Render free sleep |
| ADR-004 | Gemini via `@google/genai`, explanations only | APPROVED | Model ID comes from `GEMINI_MODEL_ID`; never hard-coded |
| ADR-005 | Supabase PostgreSQL | APPROVED | Free tier: 500 MB DB, pause after 1 week inactivity (SECONDARY, see [08](08-source-register.md)) |
| ADR-006 | Render web service hosting | APPROVED | Free: spin-down after 15 min idle, ~1 min wake (SECONDARY) |
| ADR-007 | GitHub Actions scheduled execution | APPROVED | Best effort; can be delayed or dropped |
| ADR-008 | API-Football as data provider | CANDIDATE | **Blocking validation**: free-plan season access and odds coverage (see [13](13-open-decisions.md) D-01) |
| ADR-009 | Independent Poisson baseline | APPROVED | Dixon-Coles deferred to Phase 6 |
| ADR-010 | Scanner runs inside the GitHub Actions runner (option A) | APPROVED | [02 §2.1](02-architecture.md) |
| ADR-011 | Historical results source for model fitting | PROPOSED | API-Football if free-plan seasons suffice; otherwise a second adapter for a free historical dataset (e.g. football-data.co.uk CSVs; terms to verify) |
| ADR-012 | Node 22 LTS, `node:test` runner, no TypeScript, JSDoc types | APPROVED | Minimizes dependencies; `node:test` is built in |
| ADR-013 | Schema migrations as plain SQL files under `supabase/migrations/` | APPROVED | Reviewable in Git |
| ADR-014 | Zod (or equivalent) for config and external-input validation | APPROVED | Single small dependency |
| ADR-015 | Deterministic template fallback for all Telegram messages | APPROVED | The system must work with Gemini disabled |

## Rejected / deferred alternatives

| Alternative | Reason |
|---|---|
| Microservices, message queues | Out of scope (ADR-001) |
| Long-polling bot on Render free | Instance sleeps; messages would be delayed until wake |
| Keep-alive pings to prevent Render sleep | Consumes the 750 free instance-hours like a running service; adds fragility. Not recommended unless the PO accepts it |
| Paid odds feeds | Budget is zero |
| Dixon-Coles / bivariate Poisson / ML | Deferred until the baseline has been evaluated (Phase 6) |

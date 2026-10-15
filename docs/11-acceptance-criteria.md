# 11 — Acceptance Criteria

Each criterion must be demonstrated with evidence (test output, logs, screenshots) in the phase handoff.

## Phase 0 — Foundation
- [ ] `CLAUDE.md` present on the documentation branch.
- [ ] Documents 00–13 present, internally consistent, in English.
- [ ] Every model and risk parameter carries a classification.
- [ ] Source register distinguishes verified, secondary and unverified claims.
- [ ] `.env.example` contains only names and placeholders; `.gitignore` excludes `.env*` (except `.env.example`).
- [ ] No implementation code committed.
- [ ] Open decisions listed with recommendations.

## Phase 2a — Provider feasibility spike
- [ ] Free-plan accessible seasons for each of the 5 leagues are recorded.
- [ ] Current-season fixtures are retrievable: yes/no.
- [ ] Odds for upcoming fixtures are retrievable: yes/no, with markets and bookmaker count per market.
- [ ] Odds update cadence observed (≥ 2 samples, ≥ 6 h apart).
- [ ] Actual request cost of one simulated daily scan is measured.
- [ ] Go / no-go recommendation for API-Football free plan.

## Phase 1 — Telegram and cloud skeleton
- [x] The app refuses to start with missing or invalid env vars (tested; smoke-tested: exit 1, names only).
- [x] A non-allowlisted user ID gets no response; the event is logged (tested).
- [x] A webhook request without the correct secret header gets `401` (tested + smoke test).
- [x] `/health` reports status without exposing secrets (tested, HTTP and Telegram).
- [x] Deployed on Render free (2026-10-15; `/start`, `/health` verified by the Product Owner in Telegram).
- [x] Cold-start reply time measured and reported: about 5 s after ≥ 20 min idle (Product Owner, 2026-10-15).
- [x] CI is green: lint, tests, `npm audit` (no high/critical findings). *(GitHub run 38689229255, 2026-10-15)*

## Phase 2 — Data integration
- [x] League IDs are discovered dynamically; nothing is hard-coded (discovery by name/area and sport title; tested).
- [x] Adapter unit tests run on recorded-shape, sanitized responses; live smoke test on real providers (runs 38703516262, 38706869752).
- [x] All timestamps are persisted in UTC; display tests cover `Europe/Bucharest` across a DST change.
- [x] Odds normalized to canonical market codes; invalid odds are rejected (tested; enforced again by DB checks).
- [x] Quota guard blocks calls beyond budget (tested; Supabase ledger shared across runs).
- [x] `/fixtures` and `/quota` verified by the Product Owner in Telegram (2026-10-15).

## Phase 3 — Quantitative engine
- [x] All tests in [04 §15](04-quantitative-model-spec.md) are implemented and passing (`test/model/`).
- [x] Domain modules have no I/O imports (`src/domain/model`, `src/domain/odds` import only domain code and `node:crypto`).
- [x] Determinism test passes (identical canonical output on repeated runs and shuffled input).
- [x] Preliminary real-data check documented ([17](17-phase-3-engine.md)); formal validation remains Phase 6.

## Phase 4 — Risk and explanations
- [x] Every status path is covered by tests, including multiple simultaneous reason codes.
- [x] Gemini validator rejects invented numbers, banned phrases and over-long/empty text (tested with adversarial inputs); errors and timeouts fall back to the template.
- [x] System produces complete messages with `GEMINI_API_KEY` unset (template path).
- [ ] Live Gemini call verified (needs the Product Owner's API key; optional).

## Phase 5 — Scanner and tracking
- [x] Scanner and `/analyze` call the same `analyzeFixture` (code review + test: `src/jobs/scan.js`, `src/pipeline/onDemand.js`; `test/pipeline/`).
- [x] `UPDATE`/`DELETE` on append-only tables fails (DB test `supabase/tests/predictions.test.sql`; local PostgreSQL 16).
- [ ] Duplicate scheduler trigger does not create duplicate digests. *5.2: tested (`test/jobs/scan.test.js`); live confirmation pending.*
- [x] Missed-run detection works (simulated in `test/jobs/scan.test.js`; workflow `scan-watchdog`).
- [x] Backup job produces a restorable export (restore tested once): first live run 38725832970 (2026-10-15) — export, private artifact `fvis-backup-38725832970` (587 KB, expires 2027-01-13), restore into PostgreSQL 17 with all row counts checked. Value round-trip also in CI (`test/db/backupRoundtrip.js`).

## Phase 6 — Validation
- [ ] Chronological OOS evaluation with documented train/test cut-offs.
- [ ] Metrics in [12](12-validation-plan.md) reported per league and market with sample sizes.
- [ ] Leakage audit passed.
- [ ] Written decision on `k`, windows and thresholds, and on whether to start Dixon-Coles.

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
- [ ] Cold-start reply time measured and reported. *(pending: ≥ 20 min idle, then `/health`)*
- [x] CI is green: lint, tests, `npm audit` (no high/critical findings). *(GitHub run 38689229255, 2026-10-15)*

## Phase 2 — Data integration
- [ ] League IDs are discovered dynamically; nothing is hard-coded (code review + test).
- [ ] Adapter unit tests run on recorded, sanitized responses.
- [ ] All timestamps are persisted in UTC; display tests cover `Europe/Bucharest` across a DST change.
- [ ] Odds normalized to canonical market codes; invalid odds are rejected (tested).
- [ ] Quota guard blocks calls beyond budget (tested).

## Phase 3 — Quantitative engine
- [ ] All tests in [04 §15](04-quantitative-model-spec.md) are implemented and passing.
- [ ] Domain modules have no I/O imports (dependency check).
- [ ] Determinism test passes (identical hash on repeated runs).

## Phase 4 — Risk and explanations
- [ ] Every status path is covered by tests, including multiple simultaneous reason codes.
- [ ] Gemini validator rejects invented numbers, banned phrases and unsupported selections (tested with adversarial fixtures).
- [ ] System produces complete messages with `GEMINI_API_KEY` unset.

## Phase 5 — Scanner and tracking
- [ ] Scanner and `/analyze` call the same `analyzeFixture` (code review + test).
- [ ] `UPDATE`/`DELETE` on append-only tables fails (DB test).
- [ ] Duplicate scheduler trigger does not create duplicate digests.
- [ ] Missed-run detection works (simulated).
- [ ] Backup job produces a restorable export (restore tested once).

## Phase 6 — Validation
- [ ] Chronological OOS evaluation with documented train/test cut-offs.
- [ ] Metrics in [12](12-validation-plan.md) reported per league and market with sample sizes.
- [ ] Leakage audit passed.
- [ ] Written decision on `k`, windows and thresholds, and on whether to start Dixon-Coles.

# 23 — Phase 6d plan: line-shopping paper tracker (D-24)

Status: strategy approved by the PO on 2026-10-15 (D-24). **Implementation is to start in a new session** after the PO approves this plan.
Evidence: `docs/21-phase-6b-backtest-results.md` §6 (positive closing-line edge for line shopping, negative for the model), `docs/22-phase-6c-line-shopping-feasibility.md` (Pinnacle available for every event; about 30–40 candidates per round).

## 1. Decision D-24 (principle change)

- For value candidates, the **probability source becomes the sharp market**: Pinnacle pre-match 1X2, de-vigged proportionally (CLAUDE.md §6). This amends CLAUDE.md §4.1 for this feature only: the Poisson model stays as a research reference and keeps feeding `/analyze` and the predictions table, but it no longer decides value.
- One pipeline (CLAUDE.md §4.5) is kept: the scanner and `/analyze` use the same line-shopping function.
- FVIS stays decision support: no bet placement, no staking, no bankroll management (CLAUDE.md §7).
- Gemini rules are unchanged: it may only explain the computed numbers.

## 2. Candidate rule (all thresholds PROVISIONAL)

For each fixture and 1X2 selection, from the odds captured in the same run:

| Gate | Rule | Reason |
|---|---|---|
| Sharp reference | Pinnacle has a complete, valid 1X2 set captured in this run | no reference → `INSUFFICIENT_DATA` |
| Price | best price among non-Pinnacle bookmakers; exchanges excluded (commission) | |
| Edge | `p_pin × price − 1 ≥ 0.03` | 6b: edge positive from 2%; 3% leaves room for slippage |
| Not a Pinnacle outlier | price ≥ 1.03 × median of the other bookmakers' prices | 6c: some "edges" came from Pinnacle disagreeing with the whole market |
| Odds range | 1.30–6.00 | as in 6b |
| Depth | at least 5 non-Pinnacle prices | thin markets are unreliable |
| Lead time | kickoff at least 30 minutes after capture | existing risk rule |

Status mapping: candidates passing every gate → `LINE_VALUE` (new status, paper tracking only); a positive edge failing one gate → `WATCHLIST`; otherwise `NO_VALUE` / `INSUFFICIENT_DATA`. `QUALIFIED` stays suspended (D-23).

O/U and other markets: not in scope, because Pinnacle O/U coverage in the current capture is too thin (6c §1).

## 3. Data (append-only)

- New table `line_candidates` (migration 5): run id, fixture id, market, selection, Pinnacle odds and de-vigged probability, best bookmaker and price, median price, number of prices, edge, status, reason codes, rule version, captured at. Never updated after insert.
- New table `line_candidate_outcomes`: result (won/lost), Pinnacle closing odds from football-data.co.uk, CLV = price / Pinnacle close − 1, close-EV = p_pin_close × price − 1, settled at.

## 4. Jobs and reporting

- `daily-sync` workflow: after the odds capture, a `line-scan` step writes candidates (0 extra odds credits).
- `settle` step: after a round, imports the football-data.co.uk CSV (closing odds) and settles candidates.
- Morning digest: "SELECȚIILE ZILEI" lists `LINE_VALUE` candidates (match, selection, bookmaker, price, edge, kickoff), with the paper-only reminder.
- New command `/clv`: candidates count, mean CLV, mean close-EV with 95% CI, and ROI.

## 5. Success criteria (decided before the test starts)

Evaluation after about 6 weeks or at least 150 settled candidates, whichever comes later:

| Outcome | Action |
|---|---|
| mean close-EV > 0 with the 95% CI above 0, and mean CLV > 0 | Edge confirmed live; the PO decides whether to use it |
| mean close-EV > 0 but CI includes 0 | Extend the test |
| mean close-EV ≤ 0 | Stop; line shopping does not work with these sources |

ROI is reported but is not a criterion (CLAUDE.md §8).

## 6. Prerequisite for the PO

List which of the candidate bookmakers (onexbet, unibet, leovegas, marathonbet, betsson, nordicbet, williamhill, …) are actually available to the PO. The tracker can restrict "best price" to that list, so results match what could really be played.

## 7. Estimated work

One session: migration 5, the `src/domain/lineShopping` module with unit tests, the job, the digest section, `/clv`, settlement from the CSV, and docs. No new services, no extra odds credits.

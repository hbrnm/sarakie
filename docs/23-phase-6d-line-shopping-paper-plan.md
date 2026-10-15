# 23 — Phase 6d plan: line-shopping paper tracker (D-24)

Status: strategy approved by the PO on 2026-10-15 (D-24); **plan approved and implemented on 2026-10-15** (§8), on branch `feature/phase-6d-line-shopping`, pending merge approval.
Evidence: `docs/21-phase-6b-backtest-results.md` §6 (positive closing-line edge for line shopping, negative for the model), `docs/22-phase-6c-line-shopping-feasibility.md` (Pinnacle available for every event; about 30–40 candidates per round).

## 1. Decision D-24 (principle change)

- For value candidates, the **probability source becomes the sharp market**: Pinnacle pre-match 1X2, de-vigged proportionally (CLAUDE.md §6) in rule 1.0.0, and with the **power method** from rule 1.1.0 (§9, D-25). This amends CLAUDE.md §4.1 for this feature only: the Poisson model stays as a research reference and keeps feeding `/analyze` and the predictions table, but it no longer decides value.
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

Evaluation after about 6 weeks or at least 150 settled candidates (from at least 75 distinct fixtures, D-25 §9.2), whichever comes later:

| Outcome | Action |
|---|---|
| mean close-EV > 0 with the 95% CI above 0, and mean CLV > 0 | Edge confirmed live; the PO decides whether to use it |
| mean close-EV > 0 but CI includes 0 | Extend the test |
| mean close-EV ≤ 0 | Stop; line shopping does not work with these sources |

ROI is reported but is not a criterion (CLAUDE.md §8).

## 6. Bookmakers available to the PO (answered 2026-10-15)

PO list: betano, gsbet, superbet, mrbit, unibet, fortuna.

- **VERIFIED** (Supabase, all stored odds): The Odds API (EU region) carries 23 non-Pinnacle bookmakers; of the PO list, **only Unibet**, and only as `unibet_se`, `unibet_nl`, `unibet_fr`. Betano, Superbet, Fortuna, MrBit and GSBet are absent; The Odds API has no Romanian region.
- **UNVERIFIED**: unibet.ro prices equal or track those of the SE/NL/FR sites. The digest tells the PO to check the price before relying on it.
- On today's capture, the rule in §2 gives 27 candidate selections over all bookmakers, 19 of them with a Unibet price (SQL replica of the rule, before implementation).

PO decision (2026-10-15, "both sets"): every candidate is recorded twice, scope `all` (best price over every non-exchange bookmaker: the statistical evidence) and scope `playable` (best price at the PO's bookmakers covered by the source, i.e. Unibet). The digest lists only `playable` candidates; `/clv` reports both; the §5 criteria are evaluated on both.

## 7. Estimated work

One session: migration 5, the `src/domain/lineShopping` module with unit tests, the job, the digest section, `/clv`, settlement from the CSV, and docs. No new services, no extra odds credits.

## 8. Implementation (2026-10-15)

| Part | Where |
|---|---|
| Rule (pure, deterministic), settlement measures, mean with 95% CI | `src/domain/lineShopping/index.js`, parameters in `config.js` (rule `1.0.0`, all PROVISIONAL) |
| Summary per scope and §5 verdict | `src/domain/lineShopping/report.js` |
| Scan step (0 credits), called by the scanner on the fixtures and odds of the same run | `src/jobs/lineScan.js`, `src/jobs/scan.js` |
| Settlement with CLV and close-EV | `src/jobs/lineSettle.js`; workflow step `Line settle` in `daily-sync` (`scripts/line-settle.js`) |
| Migration 5: `line_candidates`, `line_candidate_outcomes`, view `unsettled_line_candidates` | `supabase/migrations/20261015000005_line_candidates.sql` |
| Digest section, `/analyze` section, `/clv` | `src/telegram/{digest,lineView}.js`, `src/pipeline/onDemand.js`, `src/telegram/bot.js` |

Details and choices made during implementation:

- **Median** for the outlier gate is the median of the bookmakers other than the one giving the price (§2 wording). With no other bookmaker the gate is skipped and `THIN_MARKET` applies.
- **Statuses**: positive edge below 3% is `WATCHLIST` with `EDGE_BELOW_MIN` (§2 "a positive edge failing one gate"). Reason codes: `NO_SHARP_REFERENCE`, `NO_PRICE`, `NO_PLAYABLE_PRICE`, `EDGE_BELOW_MIN`, `SHARP_OUTLIER`, `ODDS_OUT_OF_RANGE`, `THIN_MARKET`, `KICKOFF_TOO_CLOSE`.
- **What is recorded**: every 1X2 selection of every domestic fixture the scanner evaluates (48 h horizon), all statuses, both scopes. A row is unique per fixture, selection, scope, Pinnacle snapshot and price snapshot, so a re-run on unchanged odds inserts nothing. `/analyze` shows the same function's output but records nothing, so each daily capture counts once.
- **Counting for §5**: each fixture selection counts once per scope, with its **first** `LINE_VALUE` row (the moment the price would have been taken).
- **Closing odds**: the `Line settle` step re-imports the current season from football-data.org and football-data.co.uk (same code as `backfill-history`, about 11 football-data.org requests, 0 odds credits). A finished candidate is settled once the Pinnacle close is stored; if it is still missing 10 days after kickoff, it is settled without CLV. Cancelled/awarded fixtures are `VOID`.
- **Scope limits**: domestic leagues only. UCL/UEL have no closing odds in football-data.co.uk (and UEL no results source), so their candidates could not be evaluated.
- **95% CI** is a normal approximation that treats selections as independent; selections of one match are not, so it is approximate (shown in `/clv`). Superseded by the fixture-clustered t interval in §9.2 and §9.5.

Verification: unit tests for the rule, settlement, report and messages, a scanner test with a Unibet `LINE_VALUE` pick, database assertions (`supabase/tests/line_candidates.test.sql`) and the backup round-trip, run locally on PostgreSQL 16.

Known limitations: the Unibet SE/NL/FR price is a proxy for unibet.ro (UNVERIFIED); Pinnacle and the price come from one daily capture, so a price can move before the PO sees it; staleness is not detectable from The Odds API timestamps (6c §3); bookmakers that are beaten repeatedly typically limit accounts.

## 9. Refinements (D-25, 2026-10-15)

Requested by the PO after a quantitative review of the 6d setup. Implemented on branch `feature/phase-6d-refinements`; no schema change, append-only tables and triggers untouched.

### 9.1 Power de-vig (rule `1.1.0`)

Proportional normalization spreads the margin in proportion to the raw probabilities, so it leaves too much probability on longshots (favourite–longshot bias). In the 3.50–6.00 part of the odds range that inflates `p_pin`, hence the edge, and creates false `LINE_VALUE` candidates.

Rule `1.1.0` de-vigs the Pinnacle 1X2 set with the **power method**:

```
r_i = 1 / odds_i            (raw implied, i ∈ {HOME, DRAW, AWAY})
find k > 0 with Σ r_i^k = 1
p_i = r_i^k
```

- Solver (`devigPower`, `src/domain/odds/index.js`): bisection on `k ∈ [1, 5]`, stopping when `|Σ r_i^k − 1| < 1e-9` or after 100 iterations. Deterministic (no randomness, fixed bracket and order). `Σ r_i^k` decreases in `k`, and with a margin `Σ r_i > 1` at `k = 1`, so the root is bracketed whenever `Σ r_i^5 < 1`.
- Fallback to proportional normalization when there is no margin to remove (`Σ r_i ≤ 1`) or the root is outside `[1, 5]` (degenerate input). The result carries `method` and `k`.
- Effect: with a margin, the longest-priced selection always gets a lower probability than under proportional normalization and the favourite a higher one. Example: 1.25 / 6.50 / 12.00 → away 8.0% proportional, 7.2% power.
- The closing-line measures use the same convention: a candidate's Pinnacle close is de-vigged with the method of its own `rule_version` (`devigMethodForRule`: `1.0.0` → proportional, otherwise power). CLV (`price / close − 1`) does not depend on the de-vig.
- Versioning: `LINE_RULE_VERSION = 1.1.0`, new parameter `devigMethod = 'power'` (PROVISIONAL), so `rule_config_hash` changes too. Existing `1.0.0` rows stay as recorded. The uniqueness key of `line_candidates` does not include the rule version: a re-run on odds snapshots already recorded under `1.0.0` inserts nothing; the next daily capture (new snapshots) is recorded under `1.1.0`.
- `/analyze` shows the same function's output, so it uses the power method too.
- Scope: only the line-shopping reference. The Poisson risk engine and the cup market view keep proportional de-vig (CLAUDE.md §6).

### 9.2 `/clv`: fixture-clustered confidence intervals

Rows of one fixture are correlated (several selections, two scopes, re-scans), so an IID interval is too narrow.

- `/clv` reports, per scope, `N_candidates` (counted candidates with a Pinnacle close) and `N_fixtures` (distinct `fixture_id` among them).
- Mean CLV and mean close-EV keep the candidate mean. The 95% CI is `mean ± t(0.975, G − 1) · √Var_CR1` (Student t with `G − 1` degrees of freedom since Phase 6d.1, §9.5) with the cluster-robust (CR1) variance at fixture level:

  ```
  Var = G / (G − 1) · Σ_g ( Σ_{i ∈ g} (x_i − mean) )² / N²
  ```

  with `G` fixtures and `N` candidates (`clusterMeanCi`, `src/domain/lineShopping/index.js`). With one candidate per fixture the standard error equals the IID one; with fewer than 2 fixtures no interval is shown.
- The §5 verdict uses this interval. **Readiness gate amended by the PO (D-25, 2026-10-15, before any `1.1.0` candidate was counted):** a verdict needs at least 6 weeks, at least 150 candidates with a Pinnacle close **and** at least 75 distinct fixtures among them (`MIN_FIXTURES`, `src/domain/lineShopping/report.js`). `/clv` shows `N_fixtures` next to the candidate count.
- `/clv` counts only candidates of the current rule version (`1.1.0`); rows of earlier versions stay in the database and are reported as a count. The test clock (6 weeks) starts at the first `1.1.0` candidate.

### 9.3 `/clv`: time to kickoff

Lead time = `kickoff_utc − created_at` of the counted candidate row (the scanner writes rows minutes after the daily 08:17 UTC capture). Computed in `lineReport` from existing columns; no schema change. Buckets, for candidates with a close: `< 12h`, `12–48h`, and `altele (> 48h)` (shown only if non-empty; the scanner horizon is 48 h). Each shows the count, mean CLV and mean close-EV. Descriptive only, no interval and no verdict per bucket.

### 9.4 Webhook: prompt acknowledgement

- The webhook already de-duplicated `update_id`s in memory (last 500). An id is marked before processing, so a re-delivery that arrives during a slow `/analyze` is dropped.
- New: the webhook answers `200` **before** processing the update (replies go through the Bot API), so a slow `/analyze` after a cold start (fresh odds, optional Gemini) no longer keeps Telegram waiting and causing re-deliveries. A failed update is logged and not retried. On shutdown the service lets accepted updates finish (up to 5 s).
- Limit: the de-duplication memory is lost on restart; since every update is acknowledged on arrival, Telegram has nothing to re-deliver from before the restart.
- Test: `test/webhook-idempotency.test.js` delivers the same `/analyze` update three times (once while the first is still waiting for odds) through the HTTP server, bot and on-demand analyzer: one odds call, one run, one reply.

### 9.5 Phase 6d.1 (D-27, 2026-10-15)

- **t quantile.** The `/clv` interval multiplies the CR1 standard error by `t(0.975, G − 1)` instead of the normal `1.96`: `mean ± t_{0.975, G−1} · √Var_CR1`. `getTQuantile975(df)` (`src/domain/lineShopping/index.js`, pure, no dependencies) uses the standard table for `df` 1–10 (12.706 … 2.228) and above that the Cornish–Fisher expansion around `z = 1.95996398`: `t ≈ z + 2.37227/df + 2.8225/df² + 2.55/df³` (within 0.001 of tabulated values, e.g. 1.9925 at `df = 74`; tends to 1.960). CR1 variance, candidate mean and the verdict thresholds (6 weeks, 150 candidates, 75 fixtures) are unchanged; fewer than 2 fixtures still give no interval. Effect: with few fixtures the interval is much wider (2 fixtures: ×6.5), at the 75-fixture gate about 1.7% wider than with 1.96.
- **Cup view wording.** Odds captured at least 3 h before kickoff now read `cote de la 11:37, capturate cu 10 h înainte de start — este posibil să se fi mișcat`.
- **Limitations.** The interval is no longer a normal approximation; it is still an asymptotic (CR1 + t) interval, which can be optimistic when a few fixtures carry most candidates.

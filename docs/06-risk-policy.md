# 06 — Risk and Eligibility Policy

Principle: **conservative by default**. When in doubt, downgrade. Statuses and their meaning are fixed by `CLAUDE.md` §7.

## 1. Evaluation order

Evaluated per (fixture, market, selection, bookmaker quote):

```
1. Fixture-level hard gates  → any failure ⇒ INSUFFICIENT_DATA for every market of the fixture
2. Market-level hard gates   → any failure ⇒ INSUFFICIENT_DATA for that market
3. EV ≤ EV_watch_min         ⇒ NO_VALUE
4. Qualification gates       → any failure ⇒ WATCHLIST
5. otherwise                 ⇒ QUALIFIED
```

Every status carries `reason_codes[]` listing **all** failed gates, not only the first one.

## 2. Hard gates

| Gate | Reason code | Rule | Threshold class |
|---|---|---|---|
| Provider coverage | `NO_PROVIDER_COVERAGE` | Provider coverage flags for the league-season include fixtures and odds | PROVIDER |
| Fixture validity | `FIXTURE_NOT_SCHEDULED` | status = `SCHEDULED` and `kickoff_utc > now` | — |
| Team mapping | `TEAM_UNMAPPED` | both teams mapped | — |
| History available | `HISTORY_UNAVAILABLE` | required seasons retrievable | — |
| League sample | `LEAGUE_BASELINE_SAMPLE` | `|W_L| ≥ N_league_min` | PROVISIONAL |
| Team sample | `TEAM_SAMPLE` | `n_i ≥ N_team_min`, current-season rule (spec §6, §8) | PROVISIONAL |
| Promoted team | `PROMOTED_TEAM_NO_HISTORY` | spec §8 | PROVISIONAL |
| Model applicability | `LAMBDA_OUT_OF_RANGE` | `λ_min ≤ λ ≤ λ_max`, `G ≤ 15` | PROVISIONAL |
| Odds present | `ODDS_MISSING` | at least one quote for the selection | — |
| Cross-league competition | `MODEL_NOT_APPLICABLE_CROSS_LEAGUE` | UCL/UEL fixtures until a validated cross-league extension exists (D-13) | — |
| Odds not fetched | `ODDS_NOT_FETCHED` | market outside the scanner's credit plan (D-11: DC, DNB, BTTS, O/U 1.5/3.5 in the scanner) | — |
| Odds validity | `ODDS_INVALID` | finite, `1.01 ≤ odds ≤ 100` | PROVISIONAL |
| Odds freshness | `ODDS_STALE` | `now − captured_at ≤ max_odds_age` **and**, if present, `now − source_timestamp ≤ max_odds_age` | PROVISIONAL: 6 h (scanner), 2 h (on-demand) |
| Odds near kickoff | `KICKOFF_TOO_CLOSE` | `kickoff_utc − now ≥ min_lead_time` (prices near kickoff move fast; data likely stale) | PROVISIONAL: 30 min |

Note on freshness: if the provider updates pre-match odds only periodically (SECONDARY evidence suggests about daily for API-Football, see [08](08-source-register.md)), `source_timestamp` dominates. The thresholds must be revisited in Phase 2 once the actual update cadence has been measured.

## 3. Value thresholds

| Parameter | Meaning | Starting value | Class |
|---|---|---|---|
| `EV_watch_min` | EV below this ⇒ `NO_VALUE` | 0.00 | PROVISIONAL |
| `EV_qualify_min` | EV needed for `QUALIFIED` | 0.05 | PROVISIONAL |

## 4. Qualification gates (failure ⇒ `WATCHLIST`)

| Gate | Reason code | Rule | Class |
|---|---|---|---|
| Minimum edge | `EV_BELOW_QUALIFY` | `EV ≥ EV_qualify_min` | PROVISIONAL |
| Market completeness | `MARKET_INCOMPLETE` | complete comparable set from the same bookmaker and batch (spec §12) | — |
| Overround sanity | `OVERROUND_ABNORMAL` | `0 ≤ overround ≤ 0.15` for 2-way/3-way sets. A negative overround suggests an error or stale data | PROVISIONAL |
| Price outlier | `PRICE_OUTLIER` | quote within `outlier_tol` of the cross-book median | PROVISIONAL |
| Model–market divergence | `MODEL_MARKET_DIVERGENCE` | `|p_model − p_devig| ≤ div_max` (0.12). Large gaps more often indicate missing model information (injuries, rotation) than true value | PROVISIONAL |
| Probability range | `PROB_TOO_LOW` | `p_model ≥ p_qualify_min` (0.15). Longshots are where Poisson is least reliable | PROVISIONAL |
| Odds range | `ODDS_OUT_OF_RANGE` | `1.30 ≤ odds ≤ 6.00` | PROVISIONAL |
| Bookmaker count | `THIN_MARKET` | ≥ 3 bookmakers quoting the market | PROVISIONAL |
| Team history (D-18, risk 1.1.0) | `TEAM_SAMPLE_SMALL` | both teams have ≥ 10 matches in their model window (`n_H`, `n_A`); typically fails for promoted teams early in a season | PROVISIONAL |
| QUALIFIED suspension (D-23, risk 1.2.0) | `QUALIFIED_SUSPENDED` | `qualifyEnabled` = 1. Default 0 since backtest 6b (`docs/21-phase-6b-backtest-results.md`): the model is worse than the pre-match market and FVIS-like selections had negative closing-line value; re-enable only with backtest evidence of positive CLV | PROVISIONAL |

All thresholds live in the model config. They are part of `config_hash`, so any change is a new config and is traceable.

## 4a. Line-shopping status `LINE_VALUE` (Phase 6d, D-24)

Separate from the model statuses above. For 1X2 only, from de-vigged Pinnacle odds (power method from rule 1.1.0, `docs/23` §9) and the best non-Pinnacle price: `LINE_VALUE` when edge ≥ 3%, price ≥ 1.03 × the other bookmakers' median, odds 1.30–6.00, at least 5 prices and kickoff ≥ 30 min after capture; a positive edge failing any of these is `WATCHLIST`. `LINE_VALUE` means **recorded for paper tracking only**: not safe, not guaranteed, not a betting tip. Rule and thresholds: `docs/23` §2 and §8.

## 5. Language policy

- Allowed: "eligible for tracking", "model estimate", "potential value according to the model".
- Forbidden: "safe", "sure", "guaranteed", "lock", "risk-free", "can't lose", "bet now". The Gemini output validator enforces this list.
- `QUALIFIED` results always show the mandatory disclaimer ([01 §7](01-product-specification.md)).

## 6. Explicitly out of scope

No stake sizing (Kelly or otherwise), no bankroll tracking, no bet placement. Paper-tracking metrics use a notional 1 unit per selection for evaluation only.

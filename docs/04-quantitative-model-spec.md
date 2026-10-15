# 04 — Quantitative Model Specification: Independent Poisson Baseline

Model family: `poisson-independent`. First version: `1.0.0`. This is a specification only; implementation is Phase 3.

> No parameter value in this document is validated. Every parameter carries a classification:
> `EMPIRICAL` (estimated from data by a documented procedure), `PROVISIONAL` (configured starting value, to be tuned),
> `PROVIDER` (taken from provider data), `AWAITING_VALIDATION` (no value may be used until validated).

---

## 1. Notation

| Symbol | Meaning |
|---|---|
| `t₀` | Prediction time (`asOf`). Only matches with `kickoff_utc < t₀` and a final status may be used |
| `L` | Competition (league) |
| `H`, `A` | Home team, away team of the fixture being predicted |
| `W_L` | League reference window: last `N_league` completed league matches of `L` before `t₀` |
| `W_i` | Team window: last `N_team` completed league matches of team `i` (in competition `L`) before `t₀` |
| `μ_h`, `μ_a` | League baseline home goals and away goals per match |
| `α_i`, `δ_i` | Attack and defence strength of team `i` (multiplicative, league average = 1) |
| `λ_H`, `λ_A` | Expected goals of home and away team in this fixture |

Only league matches are used in v1. Cup matches, friendlies and other competitions are excluded.

## 2. League scoring baseline (req. 5) and home advantage (req. 6)

```
μ_h = (Σ home goals in W_L) / |W_L|
μ_a = (Σ away goals in W_L) / |W_L|
HA  = μ_h / μ_a          (reported only; used implicitly through μ_h and μ_a)
```

- Home advantage is **league-specific** and enters through `μ_h` vs `μ_a`. There is no separate team-specific home-advantage parameter in v1, because team-level home effects are too noisy at these sample sizes.
- `N_league` — `PROVISIONAL`. Starting value: 380 matches, one season of a 20-team league. The window is defined by **match count**, not by season. In 18-team leagues (Bundesliga, Ligue 1: 306 matches per season), 380 matches therefore spans about 1.25 seasons.
- `μ_h`, `μ_a` — `EMPIRICAL` (computed each time from `W_L`).

If `|W_L| < N_league_min` → `INSUFFICIENT_DATA` (reason `LEAGUE_BASELINE_SAMPLE`). `N_league_min` — `PROVISIONAL`, starting value 150.

## 3. Team strengths (req. 3, 4) — venue-adjusted observed/expected ratios

For each match `m ∈ W_i`, define the *baseline expectation* of team `i`'s goals scored and conceded:

```
e_for(m)     = μ_h if i was home in m, else μ_a
e_against(m) = μ_a if i was home in m, else μ_h
```

Raw ratios:

```
r_att(i) = Σ_m goals_for(i,m)     / Σ_m e_for(m)
r_def(i) = Σ_m goals_against(i,m) / Σ_m e_against(m)
```

This pools home and away matches while correcting for venue, which roughly doubles the usable sample compared with venue-split ratios.

- `δ_i > 1` means a **weaker** defence: the team concedes more than the league average.
- Baselines `μ_h`, `μ_a` used in `e_for`/`e_against` are those computed at `t₀`. This is a documented simplification; using as-of-match baselines is a Phase 6 refinement.

## 4. Shrinkage toward league average (req. 8)

Strengths are regressed toward 1.0 (the league average) with pseudo-count `k`:

```
n_i = |W_i|
α_i = (n_i · r_att(i) + k · 1) / (n_i + k)
δ_i = (n_i · r_def(i) + k · 1) / (n_i + k)
```

- `k` — `AWAITING_VALIDATION`. It must be chosen by chronological out-of-sample log loss in Phase 6 over a grid (proposed grid: 2, 4, 6, 8, 12, 16, 24). Until Phase 6 completes, the Phase 3 default is `k = 8` and is labelled `PROVISIONAL`.
- `N_team` — `PROVISIONAL`. Starting value: 38 (the window may span the previous season, which is how regression across seasons happens in v1).
- No time-decay weighting in v1 (equal weights inside `W_i`). Exponential decay is a Phase 6 candidate.

## 5. Expected goals (req. 1, 2)

```
λ_H = μ_h · α_H · δ_A
λ_A = μ_a · α_A · δ_H
```

Sanity bounds (model-applicability gate, see [06](06-risk-policy.md)): if `λ_H` or `λ_A` falls outside `[λ_min, λ_max]` → `INSUFFICIENT_DATA` (reason `LAMBDA_OUT_OF_RANGE`).
`λ_min = 0.2`, `λ_max = 4.5` — `PROVISIONAL`, to be replaced by empirical percentiles from the backtest.

## 6. Sample-size requirements (req. 7)

| Check | Rule | Classification |
|---|---|---|
| League baseline | `|W_L| ≥ N_league_min` (150) | PROVISIONAL |
| Team sample | `n_i ≥ N_team_min` for both teams; `N_team_min = 5` | PROVISIONAL |
| Team sample, current season | at least `N_cur_min = 3` matches of the current season, unless pre-season fallback applies (§8) | PROVISIONAL |

Below these floors the result is `INSUFFICIENT_DATA`. Shrinkage does **not** replace the floors. A team with 2 matches is not "rescued" by shrinkage into a confident prediction.

## 7. Missing-data behavior (req. 9)

| Situation | Behavior |
|---|---|
| Match in window with missing score or non-final status | Excluded; counted in `excluded_matches` diagnostic |
| Postponed/abandoned/awarded matches | Excluded |
| Team identity cannot be mapped (provider team ID unknown) | `INSUFFICIENT_DATA` (`TEAM_UNMAPPED`) |
| Provider returns fewer seasons than needed | `INSUFFICIENT_DATA` (`HISTORY_UNAVAILABLE`) |
| Odds missing for a market | That market only → `INSUFFICIENT_DATA` (`ODDS_MISSING`); other markets still evaluated |
| Data older than freshness limit | see [06](06-risk-policy.md) |

No imputation of goals or odds, ever.

## 8. New and promoted teams (req. 10)

Because only the top five leagues are in scope, a promoted team has **no in-scope history** for its new league.

v1 rule:

1. Matches from the team's previous seasons in the **same** league count normally (e.g. a team relegated and promoted back within the window).
2. Otherwise, before the team has `N_team_min` matches in the current league season, the result is **`INSUFFICIENT_DATA` (`PROMOTED_TEAM_NO_HISTORY`)**.
3. Optional prior (`AWAITING_VALIDATION`, Phase 6): `α_prior`, `δ_prior` = average first-`N_team_min`-match strengths of all promoted teams in that league over prior seasons. It may be enabled only after backtesting shows it does not degrade calibration. When enabled, the shrinkage target for promoted teams becomes `(α_prior, δ_prior)` instead of `(1, 1)`.

Start of season: the window spans the previous season, so established teams usually have enough data from matchday 1. Gate `N_cur_min` is then relaxed to 0 for teams with `n_i ≥ N_team` from the previous season. This is `PROVISIONAL` and must be reviewed in Phase 6, because summer squad changes are not modelled.

## 9. Score probability matrix (req. 11)

```
P(h, a) = Pois(h; λ_H) · Pois(a; λ_A),     h, a ∈ {0, …, G}
Pois(x; λ) = e^{-λ} λ^x / x!     (computed iteratively: p₀ = e^{-λ}, p_{x+1} = p_x · λ/(x+1))
```

- `G` chosen per fixture as the smallest integer such that both one-sided tails satisfy `P(X > G) < 1e-12`. A hard cap of `G = 15` applies; beyond it → `INSUFFICIENT_DATA` (`LAMBDA_OUT_OF_RANGE`).
- The matrix is **not renormalized**. The residual tail mass `ε = 1 − ΣP(h,a)` is stored as a diagnostic. Over/Under probabilities are computed from the cumulative side (§10), so truncation error is bounded by `ε`.
- Float64 throughout. Results are rounded only at presentation time (probabilities 4 d.p., odds 2 d.p.). Persisted values keep full precision.

## 10. Market probabilities (req. 12)

Let `T = h + a`.

| Market | Selection | Probability |
|---|---|---|
| 1X2 | Home / Draw / Away | `P_H = Σ_{h>a} P`, `P_D = Σ_{h=a} P`, `P_A = Σ_{h<a} P` |
| Double Chance | 1X / 12 / X2 | `P_H+P_D`, `P_H+P_A`, `P_D+P_A` |
| Draw No Bet | Home | win `P_H`, push `P_D`, loss `P_A` |
| Draw No Bet | Away | win `P_A`, push `P_D`, loss `P_H` |
| Over/Under k.5 (k=1,2,3) | Under | `P(T ≤ k) = Σ_{h+a≤k} P` |
| Over/Under k.5 | Over | `1 − P(T ≤ k)` |
| BTTS | Yes | `(1 − e^{−λ_H})(1 − e^{−λ_A})` |
| BTTS | No | `1 − Yes` |

Cross-checks (must hold in tests within 1e-9 + ε):

- `P_H + P_D + P_A = 1 − ε`.
- `P(T ≤ k)` from the matrix equals the Poisson CDF with mean `λ_H + λ_A`, by independence.
- BTTS from the closed form equals `Σ_{h≥1,a≥1} P`.

### Known structural limitations of independent Poisson (must be shown to the user as "model limitations")

- It tends to **underestimate draws and 0-0 / 1-1 scores** (the motivation for Dixon-Coles, deferred).
- It assumes no correlation between home and away goals.
- It contains no information on injuries, suspensions, rotation, motivation, weather, or managerial change.
- Strengths are static within the window. There is no form or time decay in v1.

## 11. Fair odds (req. 13)

```
fair_odds = 1 / p_model                       (binary and 1X2 selections)
fair_odds_DNB = 1 + p_loss / p_win            (from EV = 0 with push = 0; equivalent to (p_win+p_loss)/p_win)
```

If `p_model < p_floor` (`PROVISIONAL`, 0.02), fair odds are reported as "n/a" and the selection cannot be `QUALIFIED`.

## 12. Market-side probabilities and EV

Conventions from `CLAUDE.md` §6. All odds are decimal.

```
p_raw   = 1 / odds
p_fair_i = p_raw_i / Σ_j p_raw_j       only for a complete comparable set
EV_binary = p_model · odds − 1
EV_DNB    = p_win · (odds − 1) − p_loss
overround = Σ p_raw − 1
```

Complete comparable sets require **same bookmaker, same snapshot**:

| Market | Set | De-vig allowed? |
|---|---|---|
| 1X2 | {Home, Draw, Away} | Yes |
| O/U k.5 | {Over k.5, Under k.5}, same line | Yes |
| BTTS | {Yes, No} | Yes |
| DNB | {Home DNB, Away DNB} | Yes. The two outcomes partition "no draw"; the de-vig prob is conditional on no draw and is compared with `P_H/(P_H+P_A)` |
| Double Chance | {1X, 12, X2} | **No.** The outcomes overlap; Σp_fair ≈ 2. Proportional normalization to 1 is forbidden. The market reference for DC is derived from the same bookmaker's de-vigged 1X2 (e.g. `p_fair(1X) = p_fair(H) + p_fair(D)`) when available; otherwise it is reported as raw implied only |

If any outcome of a set is missing, de-vig is not computed for that set (`MARKET_INCOMPLETE`). EV can still be computed from the model probability and the quoted price, but the status cannot exceed `WATCHLIST`.

Price selection: EV is computed **per bookmaker quote**. The digest shows the best price and the bookmaker that offered it. A price that deviates from the cross-bookmaker median implied probability by more than `outlier_tol` (`PROVISIONAL`, 0.05 absolute) is flagged `PRICE_OUTLIER` and cannot qualify.

## 13. Model versioning (req. 14)

- `model_version` follows semver: MAJOR = formula change, MINOR = new market or feature, PATCH = bug fix with identical intended behavior.
- `config_hash` = SHA-256 of the canonical JSON (sorted keys) of all parameters in §14.
- Each prediction stores `model_version`, `config_hash`, `asOf`, `data_cutoff_utc`, and the input diagnostics (`n_H`, `n_A`, `|W_L|`, `μ_h`, `μ_a`, strengths, `λ`s, `ε`).
- A `model_versions` row is immutable once any prediction references it.

## 14. Parameter register

| Parameter | Value (v1.0.0) | Class | Validation path |
|---|---|---|---|
| `N_league` | 380 matches | PROVISIONAL | Phase 6 sensitivity |
| `N_league_min` | 150 matches | PROVISIONAL | Phase 6 |
| `N_team` | 38 matches | PROVISIONAL | Phase 6 grid |
| `N_team_min` | 5 matches | PROVISIONAL | Phase 6 |
| `N_cur_min` | 3 matches | PROVISIONAL | Phase 6 |
| `k` (shrinkage) | 8 | PROVISIONAL → AWAITING_VALIDATION | Phase 6 OOS log-loss grid |
| `μ_h`, `μ_a` | computed | EMPIRICAL | per run |
| `α_i`, `δ_i` | computed | EMPIRICAL | per run |
| `λ_min`, `λ_max` | 0.2, 4.5 | PROVISIONAL | backtest percentiles |
| tail tolerance | 1e-12, `G ≤ 15` | PROVISIONAL (numerical) | unit tests |
| `p_floor` | 0.02 | PROVISIONAL | Phase 6 |
| `outlier_tol` | 0.05 | PROVISIONAL | Phase 6 |
| promoted prior | disabled | AWAITING_VALIDATION | Phase 6 |
| goals, results, fixtures | provider data | PROVIDER | adapter validation (Phase 2) |
| odds | provider data | PROVIDER | adapter validation (Phase 2) |

## 15. Numerical and statistical tests (req. 15)

Phase 3 acceptance requires all of the following to be automated.

**Numerical (unit)**

1. `Pois(x; λ)` matches reference values (e.g. λ=1.5: P(0)=0.22313016, P(1)=0.33469524, P(2)=0.25102143) to 1e-8.
2. Matrix sum = `1 − ε`, with `ε < 1e-11`, for λ in a grid over [0.2, 4.5].
3. `P_H + P_D + P_A + ε = 1` (1e-12).
4. DC identities: `P(1X) + P(X2) + P(12) = 2(1 − ε)`.
5. O/U: `P(Over) + P(Under) = 1`; matrix CDF equals Poisson CDF with mean `λ_H+λ_A` (1e-10).
6. BTTS closed form equals the matrix sum (1e-10).
7. Symmetry: `λ_H = λ_A` ⇒ `P_H = P_A`.
8. Monotonicity: increasing `λ_H` strictly increases `P_H` and `P(Over 2.5)`.
9. Fair odds × p = 1. DNB fair odds give EV = 0.
10. EV worked examples: p=0.55, odds 2.00 → EV = 0.10. DNB p_win=0.5, p_loss=0.3, odds 1.70 → EV = 0.5·0.7 − 0.3 = 0.05.
11. De-vig: complete 1X2 set sums to 1. An incomplete set raises `MARKET_INCOMPLETE`. A DC set is never proportionally normalized.
12. Input validation: odds ≤ 1, NaN, Infinity, negative goals → rejected.

**Determinism and leakage**

13. Same inputs + same config → byte-identical serialized output (run twice, compare hashes).
14. Leakage guard: injecting a match with `kickoff_utc ≥ asOf` into the input does not change the output.
15. `config_hash` changes whenever any parameter changes.

**Statistical (Phase 3 smoke, Phase 6 full)**

16. Simulation recovery: generate synthetic seasons from known `α, δ, μ` and check that estimated strengths are unbiased within tolerance as sample size grows.
17. On real held-out data: mean predicted total goals is within the 95% CI of the observed mean, per league.
18. Full calibration and scoring: see [12-validation-plan](12-validation-plan.md).

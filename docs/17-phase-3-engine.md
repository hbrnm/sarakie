# 17 — Phase 3: Quantitative Engine (independent Poisson v1.0.0)

Implements [04 — model specification](04-quantitative-model-spec.md). Pure, deterministic domain code with no I/O and no Telegram output (that comes in Phases 4–5).

## Modules

| File | Content | Spec |
|---|---|---|
| `src/domain/model/config.js` | parameters with classification, canonical JSON, `configHash` (SHA-256), model family/version | §13, §14 |
| `src/domain/model/poisson.js` | iterative pmf, upper tail, goals cutoff | §9 |
| `src/domain/model/scoreMatrix.js` | independent score matrix, ε diagnostic (no renormalization) | §9 |
| `src/domain/model/strengths.js` | league baseline μh/μa, venue-adjusted ratios, shrinkage | §2–§4 |
| `src/domain/model/markets.js` | 1X2, DC, DNB (win/push/loss), O/U 1.5/2.5/3.5, BTTS; fair odds | §10, §11 |
| `src/domain/odds/index.js` | implied probability, de-vig of complete sets, DC from 1X2, DNB conditional, EV (binary and DNB) | §12, CLAUDE.md §6 |
| `src/domain/model/estimate.js` | gates, leakage guard, λ, matrix, markets, diagnostics, versioning | §5–§8 |

`estimate()` returns `status: 'OK'` with probabilities and fair odds, or `status: 'INSUFFICIENT_DATA'` with all applicable reason codes: `LEAGUE_BASELINE_SAMPLE`, `LEAGUE_BASELINE_DEGENERATE`, `TEAM_SAMPLE`, `TEAM_SAMPLE_CURRENT_SEASON`, `PROMOTED_TEAM_NO_HISTORY`, `LAMBDA_OUT_OF_RANGE`, `MODEL_NOT_APPLICABLE_CROSS_LEAGUE`.

## Tests (all automated, `npm test`)

| Spec §15 | Test |
|---|---|
| 1–12 numerical | `test/model/numerical.test.js`: pmf reference values, ε < 1e-11 over a λ grid, 1X2/DC/OU/BTTS identities, symmetry, monotonicity, fair odds, EV examples, de-vig rules, invalid odds |
| 13 determinism | identical canonical JSON across runs and shuffled input |
| 14 leakage | matches at/after `asOf` (including the fixture's own result) do not change the output; `asOf` after kickoff is refused |
| 15 config hash | changes for every parameter |
| 16 simulation recovery | strengths recovered from 10 synthetic seasons (correlation > 0.9, error falls with sample size); shrinkage lowers small-sample error |
| 17 statistical smoke | synthetic: mean predicted total goals within the 95% CI of observed |

## Spec correction

The score-matrix cap `G ≤ 15` was inconsistent with the 1e-12 tail tolerance at λ = 4.5. The cap is now 30 (G = 26 needed at λ_max). Numerical only.

## Preliminary real-data check (NOT the Phase 6 validation)

2,046 finished league matches (seasons 2025 + 2026 to date) exported read-only from Supabase. Each match was predicted with `asOf` = kickoff − 1 h, using only earlier matches. Benchmark: de-vigged closing 1X2 (market average, football-data.co.uk).

| | Log loss (1X2) | Multiclass Brier |
|---|---|---|
| Model (1,190 matches with `OK`) | 1.0079 | 0.6019 |
| Closing market | 0.9806 | 0.5845 |
| League base rates | 1.0809 | 0.6543 |

| League | Matches | OK | Mean predicted goals | Mean observed goals |
|---|---|---|---|---|
| EPL | 440 | 276 | 2.77 | 2.76 |
| LALIGA | 458 | 294 | 2.68 | 2.85 |
| SERIEA | 440 | 276 | 2.41 | 2.53 |
| BUNDESLIGA | 349 | 168 | 3.21 | 3.31 |
| LIGUE1 | 359 | 176 | 2.83 | 2.81 |

Reading:
- The model is clearly better than base rates and, as expected, worse than the closing market. This is consistent with a baseline Poisson model; it does **not** indicate exploitable value.
- 856 matches were `INSUFFICIENT_DATA`: 752 `LEAGUE_BASELINE_SAMPLE` and 306 `PROMOTED_TEAM_NO_HISTORY` (reasons can co-occur), almost all in the first months of 2025 because stored history starts in August 2025. Loading earlier seasons (football-data.co.uk has them) would remove most of these. Recommended for Phase 6.
- Predicted totals slightly under the observed totals in LALIGA, SERIEA and BUNDESLIGA. To be examined in Phase 6 together with the known draw/low-score bias of independent Poisson.
- This check is in-sample with respect to parameter choice (no tuning was done), small and short. Formal chronological validation is Phase 6 ([12](12-validation-plan.md)).

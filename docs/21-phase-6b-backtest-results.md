# 21 — Phase 6b: comparative model backtest (results)

Run: GitHub Actions `model-backtest`, run 38743313562 (attempt 2), 2026-10-15 13:44–13:50 UTC, commit `498d5ad`.
Tool: [`spike/model-backtest.js`](../spike/model-backtest.js). Measurement only: production model and risk rules unchanged.
All numbers below are **VERIFIED** from that run's log unless marked otherwise.

## 1. Design

- Data: football-data.co.uk CSVs, EPL, La Liga, Serie A, Bundesliga, Ligue 1, seasons 2019/20–2025/26. 2019/20 is history only.
- Walk-forward: every prediction uses only matches played before the match's UTC calendar day.
- Tuning seasons 2020/21–2023/24 (6,981 compared matches) choose the shrinkage `k`, the time decay `ξ` and the blend weight. Test seasons 2024/25–2025/26 (2,559 matches; 2,533 with O/U 2.5 odds) are reported once.
- Compared set: matches where every model has an output and Pinnacle pre-match and closing 1X2 odds exist (9,540 of 10,734 considered). Promoted teams with fewer than 5 matches are excluded by all models.
- Models: league base rates; **FVIS v1** (the production engine `estimate()`, `k = 8`); weighted Poisson MLE with time decay (PO); Dixon-Coles (DC); a model/market blend; Pinnacle pre-match (PIN_PRE, available at prediction time) and Pinnacle closing (PIN_CLOSE, reference only), both de-vigged proportionally.
- Paper selections: an FVIS-like rule (EV ≥ 5%, p ≥ 0.15, odds 1.3–6, |p − p_market| ≤ 0.12) on 1X2 and O/U 2.5, 1 unit each, priced at Pinnacle pre-match (`pin`) or the best pre-match price across books (`max`). **close-EV** = de-vigged Pinnacle closing probability × odds taken − 1: the low-variance estimate of real edge.

## 2. Results (test seasons)

| Model | LL 1X2 | ΔLL 1X2 vs PIN_PRE [95% CI] | LL O/U 2.5 | ΔLL O/U vs PIN_PRE [95% CI] |
|---|---|---|---|---|
| Base rates | 1.0761 | +0.1140 [0.0995, 0.1292] | 0.6888 | +0.0140 [0.0079, 0.0201] |
| **FVIS v1 (production)** | 0.9882 | **+0.0261 [0.0194, 0.0327]** | 0.6873 | +0.0126 [0.0073, 0.0178] |
| PO ξ = 0.002 | 0.9847 | +0.0226 [0.0166, 0.0286] | 0.6880 | +0.0133 [0.0074, 0.0191] |
| DC ξ = 0.002 | 0.9847 | +0.0227 [0.0168, 0.0287] | 0.6880 | +0.0133 [0.0074, 0.0191] |
| PIN_PRE | 0.9620 | — | 0.6747 | — |
| PIN_CLOSE | 0.9605 | −0.0015 [−0.0043, 0.0012] | 0.6715 | −0.0032 [−0.0055, −0.0009] |

- Every model is **significantly worse than the pre-match market** on both markets, in every league and every season.
- The blend chose weight **0** on the model (tuning: 0 → 0.9753, 0.1 → 0.9760, …): the model adds no information the market does not already have.
- O/U 2.5: no model is meaningfully better than league base rates (0.6873 vs 0.6888).
- FVIS v1 versus alternatives: time decay and Dixon-Coles improve 1X2 log loss by about 0.0035 only. Dixon-Coles fixes the draw bias (mean P(draw) 23.5% FVIS, 24.6% DC, observed 24.9%; mean ρ = −0.058). `k = 8` is already the best shrinkage in the grid.

Paper selections with the FVIS-like rule:

| Model | Set | Book | Bets | mean model EV | ROI [95% CI] | mean CLV | close-EV [95% CI] |
|---|---|---|---|---|---|---|---|
| FVIS v1 | test | pin | 2,781 | +15.3% | −7.5% [−12.8%, −2.5%] | −0.8% | −3.7% [−4.0%, −3.5%] |
| FVIS v1 | test | max | 3,135 | +15.8% | −4.5% [−9.8%, +0.6%] | −1.0% | −1.8% [−2.1%, −1.5%] |
| FVIS v1 | tuning | pin | 7,666 | +14.9% | −5.5% [−8.6%, −2.4%] | −0.7% | −3.3% [−3.5%, −3.1%] |
| FVIS v1 | tuning | max | 9,165 | +15.5% | −3.2% [−6.0%, −0.5%] | −1.9% | −0.8% [−1.0%, −0.7%] |
| DC ξ = 0.002 | test | pin | 2,803 | +14.3% | −6.9% [−12.0%, −1.7%] | −0.6% | −3.5% [−3.8%, −3.3%] |
| DC ξ = 0.002 | test | max | 3,256 | +14.8% | −4.6% [−9.3%, +0.4%] | −0.6% | −1.4% [−1.7%, −1.1%] |

The model's claimed EV (about +15%) is an artefact of model error: the real edge measured against the closing line is negative, and prices move against the selections (negative CLV).

## 3. Interpretation (docs/12 §6 decision rules)

- "Model log loss worse than naive base rates": **no** for 1X2 (clearly better); borderline for O/U 2.5.
- "Calibrated but no CLV → keep as a research tool; tighten thresholds": **this is the observed case**, and stronger: CLV and close-EV are negative. Tightening the EV threshold does not fix it, because the large-EV selections are where the model disagrees most with a market that is more accurate than the model.
- **Current `QUALIFIED` selections are not evidence of value.** Historically, the same rule lost about 4–7% per unit.

## 4. Limitations (model comparison)

- One market reference (Pinnacle). The live system prices against The Odds API's EU bookmakers, whose de-vigged consensus may be less sharp than Pinnacle. This is UNVERIFIED and does not change the model-vs-market gap.
- Compared test sample 2,559: Pinnacle odds are missing for part of 2025/26 (cause UNVERIFIED). Bundesliga test n = 434.
- History starts in 2019/20, while production uses football-data.org history; edge cases for teams returning after several seasons differ.
- No injuries, line-ups, xG or schedule information in any model.
- D-18 (the < 10 matches cap) and odds-freshness gates are not simulated.

## 6. Line shopping without a model (run 38748288174, commit `1e77ee5`)

Probability = de-vigged pre-match market (Pinnacle, or the market average); price = best pre-match price across books (football-data.co.uk `Max`); a selection is taken when p × price − 1 ≥ edge, price 1.3–6, on 1X2 and O/U 2.5. CLV is against the best closing price; close-EV against the de-vigged Pinnacle close.

| Source | Edge | Set | Bets | ROI [95% CI] | mean CLV | beat close | close-EV [95% CI] |
|---|---|---|---|---|---|---|---|
| Pinnacle | 2% | tuning | 2,943 | +0.3% [−5.1%, +6.4%] | +1.2% | 60.2% | **+3.4% [+3.1%, +3.7%]** |
| Pinnacle | 2% | test | 600 | +2.7% [−10.2%, +16.0%] | +3.3% | 70.3% | **+4.0% [+3.2%, +4.8%]** |
| Pinnacle | 5% | tuning | 477 | −2.4% [−17.4%, +14.0%] | +1.9% | 62.7% | **+6.4% [+5.4%, +7.3%]** |
| Pinnacle | 5% | test | 109 | +3.4% [−29.1%, +35.5%] | +5.3% | 68.8% | **+7.6% [+4.8%, +11.5%]** |
| Market average | 2% | tuning | 2,640 | −2.3% [−8.9%, +4.5%] | −0.4% | 49.3% | +2.0% [+1.7%, +2.4%] |
| Market average | 2% | test | 494 | −12.6% [−28.1%, +3.4%] | +1.7% | 60.5% | +2.1% [+1.1%, +3.2%] |
| Market average | 5% | tuning | 304 | +11.0% [−9.8%, +34.3%] | +1.1% | 53.3% | +4.3% [+3.0%, +5.6%] |
| Market average | 5% | test | 40 | +25.4% [−29.8%, +86.3%] | +9.6% | 67.5% | +10.3% [+3.3%, +21.0%] |

Interpretation:

- Using the **sharp market as the probability** and taking only prices above it gives a **positive closing-line edge**, stable between tuning and test (close-EV +3–4% at 2%, +6–8% at 5%; CIs exclude zero). This is the opposite of the model-based selections (−3.7%).
- Realised ROI is positive but not statistically distinguishable from zero: the samples are too small for profit to show through the variance (about 350 selections per season at 2%, about 65 at 5%).
- The market average is a weaker probability source than Pinnacle (smaller and less stable edge).

Limitations specific to line shopping (material):

- `Max` is the best price across many bookmakers at one collection time; some of them are not available to the user, and the price may be gone when placed. Live availability is UNVERIFIED.
- Soft bookmakers that are repeatedly beaten restrict or close accounts. This is an operational limit, not modelled.
- The live odds source (The Odds API, EU region) must provide a sharp reference (e.g. Pinnacle) and enough bookmakers: UNVERIFIED for the current plan.
- FVIS remains decision support: no automated betting or staking (CLAUDE.md §7).

## 7. Open decision

`QUALIFIED` is suspended (D-23). Open: whether FVIS should report market-based line-shopping candidates (sharp de-vigged probability vs best available price) instead of model-based selections. This changes the approved principle that the quantitative model is the source of probabilities (CLAUDE.md §4.1) and needs an explicit PO decision and a live feasibility check of the odds source.

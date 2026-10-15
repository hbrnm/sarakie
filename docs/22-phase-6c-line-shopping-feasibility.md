# 22 — Phase 6c: line-shopping live feasibility (measurement)

Date: 2026-10-15. Source: odds stored in Supabase by the daily sync and `/analyze` (The Odds API, EU region, captures 08:36–11:03 UTC on 2026-10-15), read with SQL through the Supabase connector. Measurement only: nothing in production changed.
Facts below are **VERIFIED** from those queries unless marked otherwise.

## 1. Is a sharp reference available?

- **Pinnacle is present for all 95 stored events** (77 domestic: Bundesliga 18, La Liga 21, Ligue 1 18, Serie A 20; UEL 18), with a complete 1X2 set for every event.
- Pinnacle O/U: complete pairs on 24 events in the stored lines; BTTS: 1 event. Line shopping is realistic for **1X2 only** under the current capture (D-11 fetches 1X2 and the main O/U line).
- Other bookmakers: 23 in total; on average **16.8 non-Pinnacle prices per 1X2 selection** (exchanges `betfair_ex_eu`, `matchbook` excluded from "best price": commission not modelled).

## 2. Candidates in today's capture

Rule from the 6b backtest: probability = Pinnacle de-vigged (proportional), price = best non-Pinnacle bookmaker price, taken when p × price − 1 ≥ edge and price 1.3–6.

| Competition | Events | 1X2 edge ≥ 2% | 1X2 edge ≥ 5% | O/U edge ≥ 2% |
|---|---|---|---|---|
| Bundesliga | 18 | 10 | 2 | 0 |
| La Liga | 21 | 6 | 2 | 0 |
| Ligue 1 | 18 | 9 | 4 | 0 |
| Serie A | 20 | 11 | 4 | 1 |
| UEL | 18 | 2 | 0 | 0 |
| **Total** | **95** | **38** | **12** | **1** |

Kickoffs span 15–26 October, so one capture covers about one round per league. The backtest rate at 2% was about 0.23 candidates per match; today's 36 domestic candidates over 77 matches (0.47) is higher, plausibly because many prices were captured up to 10 days before kickoff (UNVERIFIED cause).

Bookmakers that provide the candidates (edge ≥ 2%, all markets):

| Bookmaker | ≥ 2% | ≥ 5% | mean edge | mean price above the books' median |
|---|---|---|---|---|
| onexbet | 24 | 6 | 4.6% | 7.2% |
| unibet_se | 22 | 11 | 4.6% | 7.5% |
| unibet_nl | 21 | 7 | 3.8% | 6.9% |
| leovegas_se | 7 | 4 | 7.0% | 6.6% |
| marathonbet | 6 | 2 | 6.4% | 5.0% |
| 12 others | 1–4 each | | | |

The same price often appears at several books of one group (Unibet SE/NL, LeoVegas: one operator), so candidates overlap.

## 3. Warning signs

- Some candidates come from a price close to the bookmakers' median (for example `pmu_fr` +15% edge, price only 0.5% above the median; `unibet_fr`/`betclic_fr` below the median). There the "edge" comes from **Pinnacle disagreeing with the whole market**, which can mean a stale or mismatched Pinnacle line rather than a soft price. A live rule would need a second condition: the price must also be clearly above the other books' median.
- The Odds API `last_update` timestamps did not separate stale from fresh prices in this capture (difference ≈ 0–1 minute): staleness cannot be detected from the stored data.
- Availability of these bookmakers to the PO (country, account, stake limits) is **UNVERIFIED**. Operators that are beaten repeatedly typically restrict accounts.

## 4. Cost and live validation

- Odds credits this month: scanner 10 (6 calls), on-demand 6; provider reports 441 remaining. One daily capture costs about 10 credits (about 300 per month), leaving little room for extra captures near kickoff.
- **Closing-line validation needs no extra credits**: football-data.co.uk publishes Pinnacle closing odds after each round (already parsed by `src/providers/footballDataCoUk`). Live candidates can be judged by CLV and close-EV, as in the backtest.

## 5. Conclusion

Line shopping is **technically feasible with the current free sources** for 1X2: Pinnacle is available for every event and there are enough bookmakers to produce about 30–40 candidates per round at a 2% edge. What is not yet known is whether these prices are really available to the PO, and whether the backtest edge holds live.

## 6. Open decision

A live, paper-only test would record the candidates of each daily capture (no betting, no staking) and evaluate them weekly against the Pinnacle close from football-data.co.uk. This is implementation work and changes the approved principle that the quantitative model is the source of probabilities (CLAUDE.md §4.1, §4.5): it needs explicit PO authorization.

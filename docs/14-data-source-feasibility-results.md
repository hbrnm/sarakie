# 14 — Data Source Feasibility Results (Phases 2a and 2b)

Probe runs: 2026-10-15 05:28 UTC (2a, API-Football) and 05:41 UTC (2b, free-source combination), both on GitHub Actions. Tools: [`spike/`](../spike/README.md). All facts below are **VERIFIED** by those runs unless marked otherwise.

## 1. Verdict per source

| Source | Role | Verdict |
|---|---|---|
| API-Football (free) | fixtures, results, odds | **Not usable for live operation.** Only seasons 2022–2024. Current and previous season blocked |
| football-data.org (free) | fixtures, results | **Usable.** All 5 leagues, current season (fixtures and finished results with scores) and previous season (EPL 2025: 380 matches) |
| The Odds API (free) | pre-match odds | **Usable, but the credit quota is the binding constraint** (§3) |
| football-data.co.uk (CSV) | historical results, closing odds | **Usable for model fitting and backtesting.** Current season is updated within days. Closing odds exist for 1X2 and O/U 2.5 only |

## 2. Measured facts

### football-data.org
- IDs/codes discovered: PL 2021, PD 2014, SA 2019, BL1 2002, FL1 2015. These are for reference only; runtime discovery stays mandatory.
- Current season: 45–78 finished matches per league, all with full-time scores; 9–11 fixtures in the next 7 days per league.
- Previous season accessible. This contradicts the secondary claim "current season only" (S-51).
- Result-publication delay was **not measured**: no matches were played between 12 Oct and the run.
- 12 requests used; the 10 req/min limit was respected.

### The Odds API
- Free plan: **500 credits/month** (quota header at start: 500 remaining).
- Sport keys discovered: `soccer_epl`, `soccer_spain_la_liga`, `soccer_italy_serie_a`, `soccer_germany_bundesliga`, `soccer_france_ligue_one`.
- Featured call (`h2h,totals`, region `eu`): **2 credits per league**, covering about 18–21 upcoming events. **21–25 bookmakers** for 1X2 and **15–18** for totals.
- Main totals lines vary by event (2.5, 2.75, 3, 3.25, 3.5), so O/U 2.5 is not guaranteed in the featured call.
- Event-level market discovery: 1 credit. The market keys `double_chance`, `draw_no_bet`, `btts` and `alternate_totals` exist for EPL.
- Event-level odds for `btts,draw_no_bet,double_chance,alternate_totals`: **4 credits per event**. Bookmaker counts: DC 4, DNB 2, BTTS 4, alternate totals 5 (lines 0.5 to 3.75, including 1.5 and 3.5).
- Odds update timestamps were within about 1 minute of the run, so the data is fresh.
- Probe cost: 15 credits.

### football-data.co.uk
- Season `2627` (current): 45–78 rows per league, last match 11–12 Oct 2026, so the files are updated within a few days.
- Season `2526`: complete (380/380/380/306/306).
- Closing-odds columns: `B365CH`, `AvgCH`, `MaxCH`, `AvgC>2.5` in both seasons. **Pinnacle closing (`PSCH`, `PC>2.5`) appears in 2526 but not in 2627.**
- O/U columns exist only for line 2.5. There are no BTTS, DC or DNB columns. The probe reported `BFDCH/BFDCD/BFDCA` as "DC" columns; this was a false positive of the probe's regex. These are closing 1X2 prices of another bookmaker (`BFD` + `C`).

### Team names differ across sources
- football-data.org: `Everton FC`, `Hull City AFC`.
- The Odds API: `Everton`, `Hull City`.
- football-data.co.uk: `Everton`, `Hull`, `Man United`.

A curated cross-source alias table, `provider_team_map`, is required. Unmapped teams → `INSUFFICIENT_DATA` (`TEAM_UNMAPPED`), as already specified.

### Promoted teams are material this season
The EPL sample includes Hull City, Coventry and Ipswich, which shows that the promoted-team rule in [04 §8](04-quantitative-model-spec.md) affects real fixtures every season.

## 3. Odds credit budget (500 credits/month)

About 190 matches/month across the 5 leagues. All figures are estimates derived from measured unit costs.

| Coverage | Credits/month | Fits 500? |
|---|---|---|
| Featured `h2h,totals`, 5 leagues, every day | 300 | yes, but leaves only 200 |
| Featured, only on days with fixtures in the next 48 h (about 14 days) | about 140 | yes |
| All 7 markets for every match, **one** snapshot each (featured + event-level 4 credits) | about 900 | **no** (about 1.8×) |
| Event-level extra markets for 50 selected matches/month | 200 | yes |

**Consequences:**

- The scanner can cover **1X2 and O/U (main line)** for all matches.
- **DC, DNB, BTTS and O/U 1.5/3.5 cannot be priced for every match on the free plan.**
- DC and DNB are also thinly quoted (2–4 bookmakers), so they would mostly fail the `THIN_MARKET` gate (≥ 3 books) anyway.
- Near-kickoff "closing" snapshots for our own CLV measurement cost extra credits. For 1X2 and O/U 2.5, closing odds from football-data.co.uk can be used instead (free).

## 4. Consequences for the architecture

- Three provider adapters behind the same interface ([02 §4](02-architecture.md)): fixtures/results (football-data.org), odds (The Odds API), history/closing (football-data.co.uk).
- The **credit budget guard** for odds becomes a first-class component: monthly budget, per-run cap, reserve.
- Env var changes are needed: `FOOTBALL_DATA_ORG_KEY`, `ODDS_API_KEY` replace `API_FOOTBALL_KEY` (requires a governance update, see D-10).
- The Pinnacle-based closing benchmark is unavailable for the current season. The validation plan uses `AvgC*` (market-average closing) as the benchmark, with Pinnacle where present.

## 5. UEFA Champions League and Europa League (request 2026-10-15)

Status: **APPROVED 2026-10-15 (D-13)**: two-step approach below. UCL/UEL data availability (football-data.org tier, Odds API sport keys) must be verified at the start of Phase 2.

| Aspect | Champions League | Europa League |
|---|---|---|
| Fixtures/results (football-data.org free) | Visible in the competition list (13 competitions seen); to confirm with a probe | **Probably not in the free tier** (UNVERIFIED) |
| Odds (The Odds API) | Sport key expected (`soccer_uefa_champs_league`, UNVERIFIED) | Sport key expected (`soccer_uefa_europa_league`, UNVERIFIED) |
| History (football-data.co.uk) | No CSV (domestic leagues only, UNVERIFIED) | No CSV |
| **Model applicability** | **Not covered by the v1 model** | **Not covered** |

**Why the model does not apply as-is:** v1 team strengths are measured *relative to the team's own league* (spec §3). A Premier League team with α = 1.2 and a Primeira Liga team with α = 1.2 are not equally strong, so cross-league matches need an inter-league strength adjustment, which is not specified. Many UCL/UEL teams also come from leagues outside our data (e.g. Austria, Switzerland, Scotland, Czechia), so the system would return `INSUFFICIENT_DATA`.

**Credits:** about 30 extra matches/month in season. Featured odds for 2 more competitions cost about 4 credits per scan day (about 60/month).

**RECOMMENDATION:**

1. Short term (Phase 2): show UCL/UEL fixtures and odds in Telegram for information only. Every model output is marked `INSUFFICIENT_DATA` (`MODEL_NOT_APPLICABLE_CROSS_LEAGUE`), and no value conclusions are drawn.
2. Phase 6: specify and validate a cross-league extension (e.g. league-strength offsets estimated from European results), then enable model output for UCL/UEL only if backtests support it.

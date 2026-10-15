# 08 — Source Register

Every external claim that influences a decision is recorded here with its evidence level. Status values: `VERIFIED`, `SECONDARY`, `UNVERIFIED`, `CONTRADICTED`.

Research date: 2026-10-15. Important limitation: this Claude session's network policy **blocked direct access** to `api-football.com`, `api-sports.io` and `football-data.co.uk` (proxy `connect_rejected`). The entries below rely on web-search summaries of those pages and third-party sources. **None of the API-Football claims has been verified first-hand.** They must be verified in Phase 2 with a real free API key (by the Product Owner or in a session that is allowed to reach these hosts).

## API-Football (candidate provider)

| ID | Claim | Status | Source |
|---|---|---|---|
| S-01 | Free plan: 100 requests/day; base URL `v3.football.api-sports.io`; subscription valid 1 year | **VERIFIED** 2026-10-15 (PO dashboard screenshot: Football / Free / 100 per day / active until 2027-10-15) | API-Football dashboard, My Access |
| S-03b | League IDs discovered dynamically (2026): EPL 39, La Liga 140, Serie A 135, Bundesliga 78, Ligue 1 61; current season flag = 2026; `coverage.odds = true` | VERIFIED 2026-10-15 (probe). IDs are recorded for reference only and must still be discovered at runtime | probe run |
| S-02 | Free plan: about 10 requests/minute; daily quota resets 00:00 UTC | SECONDARY | third-party summaries ([thestatsapi.com](https://thestatsapi.com/blog/free-football-api-alternatives)) |
| S-03 | All endpoints are available on the free plan | SECONDARY | [api-football.com pricing](https://www.api-football.com/pricing) |
| S-04 | **Free plan season access is limited to seasons 2022–2024.** Seasons 2025 and 2026 (current) return the error `"Free plans do not have access to this season, try from 2022 to 2024."` | **VERIFIED** 2026-10-15 (probe run, GitHub Actions) | `provider-feasibility` run 2026-10-15T05:28Z |
| S-05 | Free plan cannot serve current-season fixtures or odds | **VERIFIED** 2026-10-15. The same plan error is returned for current-season fixtures (7-day window) and odds in all 5 leagues | same run |
| S-06 | Pre-match odds endpoint updated about once per day; historical odds limited by plan | SECONDARY (competitor blog, possible bias) | [oddspapi.io](https://oddspapi.io/blog/?p=3128) |
| S-07 | Odds retention window for past fixtures | UNVERIFIED | no source found |
| S-09 | Dashboard blocks proxy/VPN access; API calls from GitHub Actions IPs | VERIFIED: dashboard blocks proxy/VPN (PO screenshot); **API calls from GitHub Actions succeed** (HTTP 200, 2026-10-15 run) | PO screenshot; probe run |
| S-08 | Market coverage and bookmaker count for current fixtures | NOT MEASURABLE on free plan (blocked by S-04) | same run |

**Verification procedure (Phase 2a, approved D-01, option A):** run the manual workflow `provider-feasibility` (see [`spike/README.md`](../spike/README.md)) twice, at least 6 h apart. Record the results here with date and run ID (no key in logs).

Additional observation (probe run): the `/status` counter showed 1 request used after 16 probe requests. Requests rejected with a plan error may not count against the quota; this is UNVERIFIED and not relied upon.

## Render

| ID | Claim | Status | Source |
|---|---|---|---|
| S-10 | Free web service spins down after 15 min without inbound traffic | SECONDARY (official docs via search) | [render.com/docs/free](https://render.com/docs/free) |
| S-11 | Spin-up takes up to about 1 minute | SECONDARY | [render.com/docs/free](https://render.com/docs/free) |
| S-12 | 750 free instance-hours per workspace per month. Services are suspended when exhausted | SECONDARY | [render.com/docs/free](https://render.com/docs/free) |
| S-13 | Local filesystem is lost on spin-down | SECONDARY | [render.com/docs/free](https://render.com/docs/free) |

## Supabase

| ID | Claim | Status | Source |
|---|---|---|---|
| S-20 | Free plan: 500 MB database per project | SECONDARY | [supabase.com/pricing](https://supabase.com/pricing.md) |
| S-21 | Free projects are paused after 1 week of inactivity | SECONDARY | [supabase.com/pricing](https://supabase.com/pricing.md) |
| S-22 | 2 active free projects; 5 GB egress (some sources say less) | SECONDARY, partly conflicting | [supabase.com/pricing](https://supabase.com/pricing.md), [costbench](https://costbench.com/software/database-as-service/supabase/free-plan/) |
| S-23 | No automated backups / PITR on free plan | UNVERIFIED | to verify on the pricing page |

## GitHub Actions

| ID | Claim | Status | Source |
|---|---|---|---|
| S-30 | `schedule` events can be delayed during high load, especially at the top of the hour. Runs can be dropped | SECONDARY (quoting GitHub docs) | [community discussion](https://github.com/orgs/community/discussions/201738), [cronuru guide](https://cronuru.com/guides/github-actions-scheduled-workflows) |
| S-31 | Scheduled workflows only run on the default branch | SECONDARY | same |
| S-32 | Private repos on GitHub Free: 2,000 Actions minutes/month | UNVERIFIED | to verify in GitHub billing docs/settings |

## Google Gemini API

| ID | Claim | Status | Source |
|---|---|---|---|
| S-40 | Free-tier content is used to improve Google products; paid-tier content is not | SECONDARY (Google pricing page via search) | [ai.google.dev pricing](https://ai.google.dev/pricing), [billing docs](https://ai.google.dev/gemini-api/docs/billing) |
| S-41 | Free-tier rate limits vary by model (third-party figures, e.g. Flash about 10 RPM / 250 RPD) | SECONDARY, volatile | [apisrouter](https://apisrouter.com/gemini-ai-free) |
| S-42 | Free tier may be unavailable to users in the EEA/UK/Switzerland | UNVERIFIED, **relevant (PO in Romania)** | single third-party claim; must be checked in Google's current Gemini API terms |

## Alternative / supplementary sources (not approved; for evaluation only)

| ID | Source | Use | Status |
|---|---|---|---|
| S-50 | football-data.co.uk CSVs | Results + odds for the top 5 leagues. Current season updated within days; `2526` complete. Closing columns `B365C*`, `AvgC*`, `MaxC*`, `AvgC>2.5`. Pinnacle closing only in `2526`. O/U 2.5 only; no BTTS/DC/DNB | **VERIFIED** 2026-10-15 (probe 2b); terms of use still UNVERIFIED | [`docs/14`](14-data-source-feasibility-results.md) |
| S-51 | football-data.org free tier | All 5 leagues; current-season fixtures and results with scores; **previous season also accessible** (EPL 2025: 380). Result-publication delay not yet measured | **VERIFIED** 2026-10-15 (probe 2b) | [`docs/14`](14-data-source-feasibility-results.md) |
| S-52 | The Odds API free tier | 500 credits/month. `/events` (no odds) costs 0 credits (VERIFIED 2026-10-15, daily-sync run). Featured `h2h,totals` = 2 credits per league call. Event-level `btts,draw_no_bet,double_chance,alternate_totals` = 4 credits per event. 21–25 books for 1X2; 2–5 books for DC/DNB/BTTS/alt totals | **VERIFIED** 2026-10-15 (probe 2b) | [`docs/14`](14-data-source-feasibility-results.md) |

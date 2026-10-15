# 08 — Source Register

Every external claim that influences a decision is recorded here with its evidence level. Status values: `VERIFIED`, `SECONDARY`, `UNVERIFIED`, `CONTRADICTED`.

Research date: 2026-10-15. Important limitation: this Claude session's network policy **blocked direct access** to `api-football.com`, `api-sports.io` and `football-data.co.uk` (proxy `connect_rejected`). The entries below rely on web-search summaries of those pages and third-party sources. **None of the API-Football claims has been verified first-hand.** They must be verified in Phase 2 with a real free API key (by the Product Owner or in a session that is allowed to reach these hosts).

## API-Football (candidate provider)

| ID | Claim | Status | Source |
|---|---|---|---|
| S-01 | Free plan: 100 requests/day | SECONDARY | [api-football.com beginner guide](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide), [api-sports.io football](https://api-sports.io/sports/football) |
| S-02 | Free plan: about 10 requests/minute; daily quota resets 00:00 UTC | SECONDARY | third-party summaries ([thestatsapi.com](https://thestatsapi.com/blog/free-football-api-alternatives)) |
| S-03 | All endpoints are available on the free plan | SECONDARY | [api-football.com pricing](https://www.api-football.com/pricing) |
| S-04 | **Free plans are limited in available seasons**; the exact seasons are not stated publicly | SECONDARY, **critical** | [api-football.com pricing](https://www.api-football.com/pricing), [homepage](https://www.api-football.com/) |
| S-05 | Recollection: free plan restricted to older seasons (not the current one) | UNVERIFIED, **critical** | Claude prior knowledge. If true, FVIS cannot run on the free plan for current fixtures and odds |
| S-06 | Pre-match odds endpoint updated about once per day; historical odds limited by plan | SECONDARY (competitor blog, possible bias) | [oddspapi.io](https://oddspapi.io/blog/?p=3128) |
| S-07 | Odds retention window for past fixtures | UNVERIFIED | no source found |
| S-08 | Market coverage (1X2, DC, DNB, O/U 1.5/2.5/3.5, BTTS) and bookmaker count for the 5 leagues | UNVERIFIED | to be measured in Phase 2 |

**Verification procedure (Phase 2, first task):** with a free key, call `/status`, `/leagues?id=<discovered>` (inspect `seasons[].coverage`), `/fixtures?league=&season=<current>`, `/odds?fixture=<upcoming>`, `/odds/bets`, `/odds/bookmakers`. Record the results here with date and HTTP evidence (no key in logs).

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
| S-50 | football-data.co.uk CSVs | Historical results + closing odds (multiple bookmakers) for the top 5 leagues; candidate for model fitting and Phase 6 closing-line comparison | UNVERIFIED (content, update cadence, terms of use) |
| S-51 | football-data.org free tier | Fixtures/results for major leagues; no odds | UNVERIFIED |
| S-52 | The Odds API free tier | Pre-match odds alternative | UNVERIFIED |

# spike/ — Phase 2a measurement tools (NOT production code)

Nothing in this directory may be imported by application code. It exists to answer
the open questions S-01…S-08 in [`docs/08-source-register.md`](../docs/08-source-register.md).

## provider-feasibility.js

Read-only probe of the API-Football free plan, run by the manual GitHub Actions
workflow `.github/workflows/provider-feasibility.yml`.

**Measures:** plan and daily quota; dynamic discovery of the 5 league IDs; seasons and
odds coverage flags; which seasons actually return fixtures (current + 3 previous);
upcoming fixtures (7 days); for one fixture per league, which FVIS markets exist
(1X2, DC, DNB, O/U 1.5/2.5/3.5, BTTS) and from how many bookmakers; the provider's odds
`update` timestamp; and league-level odds pagination (request cost).

**Safety:** at most 35 requests per run (about 26 expected); 7 s between calls; stops if
the daily remaining quota drops below 10; the key is read from the secret and redacted from
any error; output contains aggregates only, no raw payloads.

## How to run (Product Owner)

1. Register a free account at dashboard.api-football.com and copy the API key.
   **Never paste it into chat, issues or files.**
2. GitHub → `hbrnm/sarakie` → Settings → Secrets and variables → Actions →
   *New repository secret*: name `API_FOOTBALL_KEY`, value = the key.
3. GitHub → Actions → `provider-feasibility` → *Run workflow* (branch `main`).
4. Run it a **second time at least 6 hours later**; the change in odds `update` timestamps
   between runs measures the update cadence.
5. The results are in the run's *Summary* page and in the `provider-feasibility-<id>` artifact
   (`report.json`, kept for 30 days). Both contain no secrets.

## free-sources-feasibility.js (Phase 2b, D-02 option 1)

Read-only probe of the free-source combination, run by the manual workflow
`.github/workflows/free-sources-feasibility.yml`:

| Source | Purpose | Secret | Probe cost |
|---|---|---|---|
| football-data.org | current-season fixtures + results | `FOOTBALL_DATA_ORG_KEY` | ≤ 14 requests, 7 s apart |
| The Odds API | pre-match odds, market coverage | `ODDS_API_KEY` | ≤ 10 requests; about 15 credits expected; stops below 50 remaining |
| football-data.co.uk | historical results + closing odds (CSV) | none | 10 file downloads |

**Measures:** league discovery by name; upcoming fixtures and finished results in the current
season; result lag; previous-season access; odds events, bookmaker counts, lines and update
times for 1X2 and O/U; availability of BTTS, DNB, DC and O/U 1.5/3.5 for one event; credit cost
per call; CSV seasons, rows, date range, closing-odds columns; team-name samples from all three
sources (to size the cross-source team mapping work).

A source whose secret is missing is skipped, so the probe can run with only some of the keys.

### How to run (Product Owner)

1. Free key from **football-data.org**: register at football-data.org → the key arrives by email.
2. Free key from **The Odds API**: the-odds-api.com → choose the free plan → the key arrives by email.
3. Add both as GitHub Actions secrets: `FOOTBALL_DATA_ORG_KEY`, `ODDS_API_KEY`.
4. Actions → `free-sources-feasibility` → *Run workflow* (branch `main`).
5. Send the *Summary* table back. It contains no secrets.

## cup-feasibility.js (Phase 6a, D-21)

Read-only probe for a cross-league model extension for UCL/UEL, run by the manual workflow
`.github/workflows/cup-feasibility.yml`. Measures which clubs are in the cups (The Odds API
events lists at 0 credits, stored odds events, football-data.org CL teams), how many of them
ClubElo and football-data.co.uk (main and extra leagues) cover, the depth of ClubElo history,
which historical UEFA seasons the football-data.org free tier serves, and what the
openfootball repositories contain. Output: aggregates and public club names only
(`summary-6a.md`, `report-6a.json`). Results are written up in `docs/22-phase-6a-cup-feasibility.md`.

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

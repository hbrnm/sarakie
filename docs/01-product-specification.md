# 01 — Product Specification

## 1. Purpose

FVIS is a private decision-support and research system. It estimates match-outcome probabilities with a deterministic quantitative model, compares them with bookmaker prices, and reports *potentially* mispriced markets together with data quality and model limitations.

FVIS is **not** a betting platform. It never places bets, sizes stakes or manages a bankroll.

## 2. Users

| User | Access |
|---|---|
| Product Owner | Full access via Telegram (numeric user-ID allowlist) |
| Additional users | Only by adding their numeric Telegram user ID to `TELEGRAM_ALLOWED_USER_IDS` |

There is no public access, no public dashboard and no sign-up flow.

## 3. Operating modes

Both modes call the **same** analysis pipeline (`analyzeFixture`). See [02-architecture](02-architecture.md).

### 3.1 Daily scanner

1. Triggered on a schedule (GitHub Actions; best effort, see [09](09-operational-constraints.md)).
2. Discovers in-scope fixtures inside a configurable look-ahead window (proposed: next 48 h, `PROVISIONAL`).
3. Retrieves odds for in-scope markets.
4. Runs `analyzeFixture` for each fixture.
5. Persists odds snapshots and append-only predictions.
6. Sends one Telegram digest. The digest lists `QUALIFIED` and `WATCHLIST` items and a short coverage summary: fixtures scanned, how many had `INSUFFICIENT_DATA`, and quota used.

### 3.2 On-demand analysis

1. User sends a command, e.g. `/analyze Arsenal Chelsea`, or selects a fixture from `/today` / `/fixtures`.
2. The system resolves the fixture. Ambiguous input returns a short list to choose from; it never guesses silently.
3. It fetches or reuses sufficiently fresh odds.
4. It runs `analyzeFixture`.
5. It returns, for each supported market:
   - model probability and fair odds;
   - best available odds and bookmaker;
   - raw implied and de-vigged market probability;
   - EV;
   - status, with gate reasons;
   - data-quality summary and model limitations.

On-demand results are persisted as predictions with `trigger = 'on_demand'`.

## 4. Scope

| Dimension | Initial scope |
|---|---|
| Competitions | Premier League, La Liga, Serie A, Bundesliga, Ligue 1 (IDs discovered dynamically) |
| Markets | 1X2, Double Chance, Draw No Bet, O/U 1.5, O/U 2.5, O/U 3.5, BTTS |
| Match type | Pre-match only. In-play is out of scope. |
| Time zone | Persist in UTC; display in `Europe/Bucharest` |
| Language of bot messages | **Open decision** (see [13](13-open-decisions.md)). Recommended: Romanian. |

## 5. Telegram commands (proposed, Phase 1/5)

| Command | Phase | Behavior |
|---|---|---|
| `/start`, `/help` | 1 | Usage and disclaimer |
| `/health` | 1 | Service status; no secrets are ever shown |
| `/fixtures [league]` | 5 | Upcoming in-scope fixtures |
| `/analyze <home> <away>` | 5 | On-demand analysis |
| `/scan` | 5 | Latest scanner digest (re-sent, not re-run) |
| `/quota` | 2 | Provider requests used and remaining today |

Messages from users not on the allowlist are dropped silently and logged by numeric ID only.

## 6. Explicit non-goals

- Automated bet placement, staking or bankroll management.
- Language implying certainty, such as "safe bet", "lock" or "guaranteed".
- Public dashboard, multi-tenant accounts, payments.
- Live/in-play analysis.
- LLM-generated numbers of any kind.
- Dixon-Coles or ML models before the Poisson baseline has been evaluated (Phase 6).

## 7. Mandatory disclaimer (every analysis message)

> FVIS is a research tool. Probabilities are model estimates with known limitations. `QUALIFIED` means *eligible for tracking and paper validation*, not safe, guaranteed or profitable.

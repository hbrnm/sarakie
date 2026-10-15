# 02 — Architecture

## 1. Style

A **modular monolith**: one Node.js (CommonJS) codebase, one deployable web service, and one scheduled job entry point. Both entry points import the same modules. There are no microservices, queues or caches beyond what Supabase provides.

## 2. Runtime topology

```
                         ┌──────────────────────────────┐
 Telegram ── webhook ──► │ Render web service (free)    │
 (HTTPS, secret header)  │  src/server.js               │
                         │  - POST /telegram/webhook    │
                         │  - GET  /health              │
                         │  - POST /internal/scan (opt) │
                         └──────────┬───────────────────┘
                                    │ same modules
 GitHub Actions cron ──────────►  src/jobs/scan.js   (RECOMMENDED: runs inside the Actions runner)
                                    │
             ┌──────────────────────┼─────────────────────────┐
             ▼                      ▼                         ▼
   API-Football (adapter)   Supabase PostgreSQL        Gemini (explanations only)
```

### 2.1 Where the scanner runs — RECOMMENDATION (needs approval, see [13](13-open-decisions.md) D-03)

| Option | Description | Assessment |
|---|---|---|
| **A (recommended)** | The GitHub Actions job runs `node src/jobs/scan.js` directly. It writes to Supabase and sends the Telegram digest through the Bot API. | The run is not bound by Render sleep or request timeouts, and each run produces a log. Uses Actions minutes (private repo quota, see [09](09-operational-constraints.md)). Secrets live in GitHub Actions secrets. |
| B | GitHub Actions sends `POST /internal/scan` (authenticated with `SCHEDULER_TRIGGER_SECRET`) to wake Render, and Render runs the scan. | Cold start of about 1 min. A free instance spins down 15 min after its last inbound request, which can kill a long scan. Secrets stay only on Render. |

Under option A, `SCHEDULER_TRIGGER_SECRET` is only needed if the optional `/internal/scan` endpoint is kept as a manual fallback.

## 3. Module layout (✓ = implemented)

```
src/
  config/          env loading + schema validation (fail fast, never log values)   [Phase 1 ✓]
  logging/         JSON logger with secret redaction                               [Phase 1 ✓]
  time/            Europe/Bucharest display formatting                             [Phase 1 ✓]
  http/            node:http server: /health, Telegram webhook (secret, size, dedupe) [Phase 1 ✓]
  providers/
    index.js       provider interface (contract below)
    apiFootball/   adapter: HTTP client, quota guard, response → domain mapping
  domain/
    types.js       JSDoc typedefs: Fixture, Team, OddsQuote, MarketSelection, ...
    model/         poisson.js, strengths.js, scoreMatrix.js   (pure, deterministic)
    markets/       derive probabilities for each market from the score matrix
    odds/          implied prob, de-vig, fair odds, EV        (pure)
    risk/          gates + status classification              (pure)
  pipeline/
    analyzeFixture.js   the single analysis pipeline used by both modes
  persistence/     Supabase repositories (append-only writes for snapshots/predictions)
  explain/         Gemini client, prompt builder, output validator, template fallback
  telegram/        Telegraf bot, allowlist middleware, command handlers, formatters [Phase 1 ✓]
  jobs/scan.js     scanner entry point
  server.js        web entry point                                                [Phase 1 ✓]
test/              unit + property tests; fixtures recorded from provider (sanitized)
```

Dependency rule: `domain/` imports nothing from `providers/`, `persistence/`, `explain/` or `telegram/`. `pipeline/` orchestrates them through injected interfaces, which keeps domain code fully testable offline.

## 4. Provider adapter contract

Domain code only sees normalized types:

```
listCompetitions()                          -> Competition[]   (incl. provider league id per season)
listFixtures({ competitionId, from, to })   -> Fixture[]
listResults({ competitionId, season })      -> MatchResult[]   (historical, for model fitting)
getOdds({ fixtureId })                      -> OddsQuote[]     (normalized market/selection/line)
getQuotaStatus()                            -> { used, limit, resetsAtUtc }
```

Normalization responsibilities of the adapter:

- map provider market names and bet IDs to the canonical markets in [05](05-data-dictionary.md#market-codes);
- convert all odds to decimal `numeric` values and reject values ≤ 1.0 or non-finite values;
- convert all timestamps to UTC ISO-8601;
- attach `source_provider`, the provider's own IDs, `source_timestamp` (if the provider gives one) and `captured_at`;
- discover league IDs dynamically by name and country, then verify them per season. Never hard-code them.

## 5. The single analysis pipeline

```
analyzeFixture(fixture, { asOf, modelConfig, deps }) →
  1. load historical results with kickoff < asOf           (leakage guard)
  2. compute league baselines + team strengths             (domain/model)
  3. λ_home, λ_away → score matrix                         (domain/model)
  4. market probabilities                                  (domain/markets)
  5. load odds snapshots captured ≤ asOf                   (persistence)
  6. implied / de-vig / fair odds / EV                     (domain/odds)
  7. gates + status                                        (domain/risk)
  8. persist prediction rows (append-only)                 (persistence)
  9. explanation (optional, never alters 1–7)              (explain)
```

`asOf` is explicit. Backtests in Phase 6 call the same function with historical `asOf` values.

## 6. Gemini boundary

- Input: a frozen JSON object containing the numbers produced by steps 1–7.
- Output: plain text. A validator checks it. Every number appearing in the text must exist in the input object. Banned phrases ("safe", "guaranteed", "sure", "lock", "risk-free") cause rejection. The text must not name a selection whose status is not `QUALIFIED`/`WATCHLIST`.
- If validation fails, Gemini errors, or the quota is exhausted, the system falls back to a deterministic template message. **FVIS must be fully functional with Gemini disabled.**

## 7. Persistence principles

- Timestamps are `timestamptz`, stored in UTC.
- `odds_snapshots` and `predictions` are append-only. A database trigger rejects `UPDATE`/`DELETE` (Phase 5).
- Each prediction references `model_version_id` and the exact `odds_snapshot_id`s used.
- Details: [05-data-dictionary](05-data-dictionary.md).

## 8. Cross-cutting concerns

| Concern | Approach |
|---|---|
| Configuration | Validated at startup; the process exits on missing or invalid variables |
| Logging | Structured JSON to stdout. Secrets, tokens and raw Telegram payloads are never logged |
| Time | `Date` used only in UTC; `Intl.DateTimeFormat` with `Europe/Bucharest` for display |
| Determinism | Domain functions are pure. No `Math.random`, no wall-clock reads inside domain code |
| Rate limiting | Provider quota guard persisted in `provider_request_log`; refuses calls past the budget |
| Retries | Bounded exponential backoff on 5xx/network errors only. No retry on 4xx or quota errors |

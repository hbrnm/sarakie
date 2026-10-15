# 09 — Operational Constraints (Zero Budget)

All limits below come from [08-source-register](08-source-register.md). Most are `SECONDARY` and must be re-checked before Phase 1/2 decisions rely on them.

## 1. Free-tier limits summary

| Service | Key limits | Impact on FVIS |
|---|---|---|
| API-Football free | about 100 req/day, about 10 req/min, **season access limited** | Possibly blocking (see §6). Every request must be budgeted |
| Render free | sleeps after 15 min idle, about 1 min cold start, 750 h/month, ephemeral disk | First Telegram reply after idle can take up to about 1 min. No local state |
| Supabase free | 500 MB DB, pauses after 1 week of inactivity, 2 projects | Storage budget required (§4). The daily scanner keeps the project active, but if the scanner stops for over a week the DB pauses and needs a manual restore |
| GitHub Actions | schedule best effort, delays and drops possible; private-repo minutes quota (about 2,000/month UNVERIFIED) | Scanner time not guaranteed. A short run (< 5 min) uses about 150 min/month |
| Gemini free | per-model RPM/RPD limits; content may be used by Google; EEA availability UNVERIFIED | Optional component with template fallback |

## 2. Provider request budget (estimate, to be measured in Phase 2)

| Activity | Estimated requests/day | Notes |
|---|---|---|
| Fixtures for the next 48 h (by date, filtered to 5 leagues) | 2–5 | |
| Odds for in-window fixtures (by league+date, paginated) | 10–30 | Depends on pagination; UNVERIFIED |
| Results refresh (yesterday's matches) | 1–5 | |
| One-time history backfill per league-season | 1 per league-season | Stored in DB, never re-fetched |
| On-demand analyses | remainder | Reuse odds if fresh enough (gate in [06](06-risk-policy.md)) |
| **Reserve** | ≥ 15 | Safety margin; the quota guard refuses non-essential calls below it |

The quota guard counts requests in `provider_request_log` per UTC day and reads the provider's remaining-quota header if one exists.

## 3. Scheduling

- Cron at a non-round minute (e.g. `17 6 * * *` UTC ≈ 09:17 Bucharest in summer) to avoid top-of-hour congestion.
- The scanner is idempotent per `scan_date`. A delayed or duplicated run does not create duplicate digests: a second run in the same window only appends new odds snapshots and new predictions where inputs changed.
- **Missed-run detection:** if no successful `analysis_runs` row exists for the day by a configured time, the next bot interaction (or a second cron) reports "scanner did not run today". No silent gaps.
- `workflow_dispatch` is enabled so the PO can trigger a scan manually from GitHub.

## 4. Storage budget (Supabase 500 MB)

Rough estimate (UNVERIFIED, recompute after Phase 2 measurements):

- About 1,750 fixtures per season across the 5 leagues (3 × 380 + 2 × 306).
- 16 selections per fixture × B bookmakers × C captures.
- With B = 15 and C = 2: about 840k odds rows/season. At about 150–250 bytes/row with indexes, that is **about 125–210 MB per season**.

Mitigations, by order of preference:

1. Bookmaker allowlist (configurable, e.g. 6–8 major books) → roughly halves the volume.
2. Capture only for fixtures within the look-ahead window, at most C captures per fixture.
3. Predictions store only the best quote per selection (see [05](05-data-dictionary.md)).
4. Monthly storage check, with an alert in the Telegram digest at 70% usage.
5. Archival: export old seasons to compressed CSV in a private location before any pruning. Pruning needs PO approval each time.

## 5. Reliability, retries, failure recovery

| Failure | Behavior |
|---|---|
| Provider 5xx / timeout | Retry up to 3 times with exponential backoff (1 s, 2 s, 4 s) + jitter, within quota |
| Provider 429 / quota exhausted | No retry. Run marked `PARTIAL`. Affected fixtures get `INSUFFICIENT_DATA` with `QUOTA_EXHAUSTED` |
| Provider 4xx | No retry. Logged and the record skipped |
| Supabase unavailable / paused | Run `FAILED`. Telegram message "database unavailable" (sent directly through the Bot API). No partial writes outside a transaction |
| Gemini error/invalid output | Template fallback; logged in `explanations` |
| Telegram send failure | Retry 3 times; on failure the run is still recorded, and the digest can be re-sent with `/scan` |
| Render cold start | Telegram retries undelivered webhook updates. The webhook acknowledges each update before processing it and drops repeated `update_id`s (in memory, last 500), so a slow `/analyze` cannot spend odds credits twice (`docs/23` §9.4) |

## 6. The blocking risk: API-Football free-plan season access

If verification confirms that the free plan does not cover the current season (S-04/S-05), then **no free configuration of API-Football can deliver current fixtures or odds**. Options for the PO (no decision taken):

1. Approve a supplementary free source for results (S-50/S-51) **and** for odds (S-52). Each needs its own adapter; the architecture already supports this.
2. Approve a paid API-Football tier. This would break the zero-budget constraint.
3. Reduce scope to research and backtesting only on historical data until a solution is found.

## 7. Backup and retention

- Supabase free tier: automated backups are UNVERIFIED (S-23). Assume **none**.
- **Implemented (Phase 5.4, D-08):** workflow `backup` (Sunday 02:23 UTC, plus manual runs) exports every table as CSV through the service role and stores it as a **private workflow artifact** `fvis-backup-<run id>` with 90-day retention (about 13 weekly copies). Git is **not** used for data, given repo size and privacy. The same run restores the export into a throwaway PostgreSQL with the repository migrations and checks every row count; a failed restore check fails the run (GitHub notifies the repository owner).
- Artifact storage for private repositories on the free plan is limited (about 500 MB, UNVERIFIED for this account); one export is currently a few MB zipped.
- **Restore procedure:** download the artifact (Actions → backup run → Artifacts), unzip into `backup-out/`, create an empty database (e.g. a new Supabase project), apply `supabase/migrations/*.sql` in order, then run `node scripts/backup.js restore-sql backup-out > restore.sql` and `psql -v ON_ERROR_STOP=1 -f restore.sql` against it. The script loads tables in foreign-key order, resets identity sequences and asserts all row counts in one transaction.
- Consistency: tables are exported one after another; the run is scheduled when no FVIS job writes and shares the `daily-sync` concurrency group, so it never overlaps a sync or scan.
- Retention: odds snapshots and predictions are kept indefinitely within storage limits (needed for Phase 6). Telegram audit log is kept for 180 days (PROVISIONAL).

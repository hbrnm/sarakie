# 05 — Data Dictionary

Target: Supabase PostgreSQL. This is a logical design; DDL is written in Phase 2/5. All timestamps are `timestamptz`, stored in UTC. All odds are `numeric(8,3)` decimal odds. Probabilities and EV are `double precision`.

## Market codes

| `market_code` | Selections (`selection_code`) | `line` |
|---|---|---|
| `1X2` | `HOME`, `DRAW`, `AWAY` | null |
| `DC` | `1X`, `12`, `X2` | null |
| `DNB` | `HOME`, `AWAY` | null |
| `OU` | `OVER`, `UNDER` | 1.5, 2.5, 3.5 |
| `BTTS` | `YES`, `NO` | null |

## Entities

### `competitions`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | internal |
| `code` | text unique | `EPL`, `LALIGA`, `SERIEA`, `BUNDESLIGA`, `LIGUE1` |
| `name`, `country` | text | |

### `provider_competition_map`
| Column | Type | Notes |
|---|---|---|
| `competition_id` | uuid FK | |
| `source_provider` | text | e.g. `api_football` |
| `provider_league_id` | text | discovered dynamically, never hard-coded |
| `season` | int | start year of season |
| `coverage` | jsonb | provider coverage flags as returned (fixtures, odds, statistics) |
| `discovered_at` | timestamptz | |
| PK | (`source_provider`, `provider_league_id`, `season`) | |

### `teams` / `provider_team_map`
| Column | Type | Notes |
|---|---|---|
| `teams.id` | uuid PK | |
| `teams.name`, `short_name`, `country` | text | canonical |
| `provider_team_map(source_provider, provider_team_id) → team_id` | | unique per provider |

### `fixtures`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `competition_id`, `season` | | |
| `home_team_id`, `away_team_id` | uuid FK | |
| `kickoff_utc` | timestamptz | |
| `status` | text | normalized: `SCHEDULED`, `LIVE`, `FINISHED`, `POSTPONED`, `CANCELLED`, `ABANDONED`, `AWARDED` |
| `home_goals`, `away_goals` | int null | full time (90' + stoppage), not extra time |
| `source_provider`, `provider_fixture_id` | text | unique together |
| `updated_at` | timestamptz | fixtures are mutable (status/score), unlike predictions |

### `bookmakers`
`id`, `source_provider`, `provider_bookmaker_id`, `name`. Unique (`source_provider`, `provider_bookmaker_id`).

### `odds_snapshots` — **append-only**
| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `fixture_id` | uuid FK | |
| `source_provider` | text | |
| `bookmaker_id` | FK | |
| `market_code`, `selection_code` | text | canonical codes above |
| `line` | numeric(4,2) null | |
| `decimal_odds` | numeric(8,3) | CHECK > 1.0 |
| `source_timestamp` | timestamptz null | provider's "last update", if given |
| `captured_at` | timestamptz | when FVIS fetched it |
| `capture_batch_id` | uuid | groups one fetch, so complete sets are identifiable |
| `raw_ref` | jsonb null | minimal provider identifiers for audit (no full payloads) |

### `model_versions` — immutable once referenced
`id`, `model_family` (`poisson-independent`), `model_version` (semver), `config` (jsonb), `config_hash` (sha256 hex, unique), `created_at`, `notes`.

### `analysis_runs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `trigger` | text | `scanner`, `on_demand`, `backtest` |
| `started_at`, `finished_at` | timestamptz | |
| `as_of` | timestamptz | prediction time used for data cutoff |
| `model_version_id` | FK | |
| `fixtures_considered`, `fixtures_analyzed` | int | |
| `provider_requests_used` | int | |
| `status` | text | `OK`, `PARTIAL`, `FAILED` |
| `error_summary` | text null | no secrets |

### `predictions` — **append-only**
One row per (run, fixture, market, selection, line). The row references the **best valid quote**, i.e. the highest odds among quotes that pass the hard gates and the outlier check. Per-bookmaker EVs can be recomputed from `odds_snapshots` and are not stored, which keeps storage small (see [09](09-operational-constraints.md)). Re-analysis creates **new** rows; earlier rows are never updated.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `analysis_run_id` | uuid FK | |
| `fixture_id` | uuid FK | |
| `model_version_id` | FK | |
| `as_of`, `data_cutoff_utc`, `created_at` | timestamptz | |
| `market_code`, `selection_code`, `line` | | |
| `lambda_home`, `lambda_away` | double | |
| `p_model` | double | model probability (win prob for DNB) |
| `p_push`, `p_loss` | double null | DNB only |
| `fair_odds` | double null | |
| `odds_snapshot_id` | bigint FK null | exact quote used |
| `decimal_odds` | numeric null | copied for convenience |
| `p_raw` | double null | 1/odds |
| `p_devig` | double null | null if set incomplete or DC |
| `overround` | double null | |
| `ev` | double null | |
| `status` | text | `INSUFFICIENT_DATA`, `NO_VALUE`, `WATCHLIST`, `QUALIFIED` |
| `reason_codes` | text[] | gate results, see [06](06-risk-policy.md) |
| `diagnostics` | jsonb | n_H, n_A, \|W_L\|, μ_h, μ_a, α, δ, ε, excluded matches |

### `prediction_outcomes` — evaluation, append-only
`prediction_id`, `settled_at`, `result` (`WIN`, `LOSS`, `PUSH`, `VOID`), `closing_odds_snapshot_id` (null if unavailable), `profit_per_unit` (paper only).

### `provider_request_log`
`id`, `source_provider`, `endpoint`, `requested_at`, `http_status`, `quota_remaining` (if the provider reports it), `duration_ms`. Used by the quota guard and `/quota`.

### `telegram_audit_log`
`id`, `telegram_user_id` (bigint), `authorized` (bool), `command` (text, truncated), `received_at`. No message bodies beyond the command name and arguments; no usernames required.

### `explanations`
`id`, `prediction_group` (run_id + fixture_id), `generator` (`gemini` | `template`), `model_id`, `validated` (bool), `rejection_reason`, `text`, `created_at`.

### `line_candidates` — **append-only** (Phase 6d, D-24)
One row per scanner run, fixture, 1X2 selection and scope (`all` | `playable`), all statuses. Columns: run, fixture, kickoff, rule version and config hash, Pinnacle snapshot/odds/de-vigged probability/overround/capture time, best price snapshot/bookmaker/price, median of the other bookmakers' prices, number of prices, edge (`p_pin × price − 1`), status (`INSUFFICIENT_DATA` | `NO_VALUE` | `WATCHLIST` | `LINE_VALUE`), reason codes. Unique per fixture, selection, scope, Pinnacle snapshot and price snapshot (NULLS NOT DISTINCT). `rule_version` `1.0.0`: proportional de-vig; `1.1.0`: power de-vig (`docs/23` §9). See `docs/23` §8.

### `line_candidate_outcomes` — **append-only**, one per candidate
Result (`WIN` | `LOSS` | `VOID`), score, Pinnacle closing snapshot and odds, de-vigged closing probability (method of the candidate's `rule_version`), `clv = price / pin_close − 1`, `close_ev = p_pin_close × price − 1`, paper profit per unit. View `unsettled_line_candidates`: priced candidates of final fixtures without an outcome.

## Append-only enforcement (Phase 5)

- `BEFORE UPDATE OR DELETE` triggers on `odds_snapshots`, `predictions`, `prediction_outcomes`, `model_versions` (when referenced) raise an exception.
- The application role never receives `TRUNCATE`.
- Retention pruning (if storage approaches the free-tier limit) is a documented, PO-approved manual operation, never an automatic one. See [09](09-operational-constraints.md).

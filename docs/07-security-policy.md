# 07 — Security Policy

## 1. Access control

- Authorization uses **numeric Telegram user IDs only**, taken from `TELEGRAM_ALLOWED_USER_IDS` (comma-separated integers). Usernames are never used for authorization because they can change or be transferred.
- The allowlist check is the **first** middleware. Unauthorized updates get no reply and trigger no provider, database or Gemini call. Each one is logged with its numeric ID in `telegram_audit_log`.
- The bot only processes private chats. Group or channel updates are ignored.
- An empty or unparsable allowlist is a fatal configuration error. The bot must never start open by default.

## 2. Webhook integrity

- Telegram webhook is registered with `secret_token = TELEGRAM_WEBHOOK_SECRET`. Every request must carry a matching `X-Telegram-Bot-Api-Secret-Token` header (constant-time comparison), otherwise it gets `401` and no processing.
- The webhook path must not contain the bot token.
- Request body size is limited (e.g. 1 MB). Malformed JSON gets `400`.

## 3. Scheduler endpoint (only if architecture option B or the manual fallback is used)

- `POST /internal/scan` requires `Authorization: Bearer <SCHEDULER_TRIGGER_SECRET>` (constant-time compare).
- It is idempotent per scan window: a second trigger within the window returns `409` and does not run again.

## 4. Secrets

| Rule | Detail |
|---|---|
| Never in Git | `.env` is in `.gitignore`; `.env.example` contains names and placeholders only |
| Storage | Render environment variables (web service); GitHub Actions encrypted secrets (scanner) |
| Never in chat | The Product Owner never pastes secrets into Claude chat, GitHub issues or files. Claude never asks for them |
| Never logged | The config module redacts all secret values. Errors from HTTP clients are sanitized (API keys can appear in URLs/headers) |
| Rotation | Any suspected leak → rotate immediately at the provider; the old value is considered compromised |
| Detection | GitHub secret scanning (if available on the private repo plan) + a pre-commit check proposed for Phase 1 |

## 5. Least privilege

- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. Mitigations:
  - it is used only server-side (Render and GitHub Actions), never shipped to any client;
  - RLS is enabled on all tables with **no** policies for `anon`/`authenticated`, so the public anon key gives no access;
  - **RECOMMENDATION (Phase 5)**: a dedicated Postgres role with `INSERT/SELECT` only on append-only tables, if Supabase connection constraints allow it on the free tier (to verify).
- The API-Football key is read-only by nature. The quota guard prevents quota exhaustion by bugs.
- The Gemini key is restricted in Google AI Studio / Cloud console to the Generative Language API if that option is available.

## 6. Input validation

| Input | Validation |
|---|---|
| Telegram commands | Whitelisted command names; arguments length-limited (e.g. 64 chars) and stripped of control chars; team names resolved against the DB, never interpolated into SQL |
| Provider responses | Schema-validated in the adapter; invalid records are dropped and counted, never passed to domain code |
| Gemini output | Treated as untrusted text: numeric cross-check, banned-phrase check, length limit, Telegram MarkdownV2/HTML escaping |
| Environment | Schema-validated at startup |

SQL access goes only through the parameterized Supabase client. There is no string-built SQL.

## 7. Data protection

- The only stored personal data is the numeric Telegram IDs of allowlisted users plus command logs.
- **Gemini free tier**: Google's pricing page states that free-tier content may be used to improve Google products (SECONDARY, see [08](08-source-register.md)). FVIS therefore sends Gemini only model outputs and public football data, never user identifiers, chat text or secrets.

## 8. Dependency hygiene

- Lockfile committed and minimal dependencies (ADR-012/014).
- `npm audit` in CI (Phase 1).
- Dependency versions are pinned, and upgrades go through reviewed PRs.

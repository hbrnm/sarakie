# 15 — Phase 1 Runbook: Telegram Bot on Render (free)

Deployment is performed by the Product Owner (Claude has no access to Render or Telegram accounts).
No secret is ever pasted into chat, issues or repository files.

## 1. Create the bot (Telegram, BotFather)

1. In Telegram, open **@BotFather** → `/newbot` → choose a display name and a username ending in `bot`.
2. BotFather returns the **bot token**. Keep it for step 4 only.
3. Recommended: `/setjoingroups` → *Disable* (the bot serves private chats only).

## 2. Find your numeric Telegram user ID

Open **@userinfobot** (or any equivalent ID bot) and send any message. It replies with your numeric `Id`.
This number, not the `@username`, goes in `TELEGRAM_ALLOWED_USER_IDS`.

## 3. Generate the webhook secret

Use a password generator with **letters and digits only**, length **48**. Telegram accepts only
`A–Z a–z 0–9 _ -`; symbols such as `+ / = !` are rejected (FVIS refuses to start with them).

## 4. Deploy on Render

1. render.com → sign in with GitHub → grant access to `hbrnm/sarakie`.
2. **New → Blueprint** → select `hbrnm/sarakie` (branch `main`). Render reads `render.yaml`
   and creates the `fvis-bot` free web service in Frankfurt.
3. When prompted, enter:
   - `TELEGRAM_BOT_TOKEN` — from step 1
   - `TELEGRAM_WEBHOOK_SECRET` — from step 3
   - `TELEGRAM_ALLOWED_USER_IDS` — from step 2 (several IDs: comma-separated)
4. Deploy. On start, the service registers its Telegram webhook automatically using
   `RENDER_EXTERNAL_URL` (provided by Render) + `/telegram/webhook`. If the log shows
   `telegram.webhook_not_registered`, add `WEBHOOK_BASE_URL=https://<service>.onrender.com` and redeploy.

## 5. Verify

| Check | Expected |
|---|---|
| Render logs | `server.started` and `telegram.webhook_registered` |
| `https://<service>.onrender.com/health` | `{"status":"ok",...}` |
| Send `/start` to the bot | Romanian welcome message with disclaimer |
| Send `/health` | Status, version, uptime, Bucharest time |
| Message from another Telegram account | No reply; Render log `telegram.unauthorized` with numeric ID |
| After ≥ 20 min idle, send `/health` | Reply arrives after a cold start (measure seconds; record in the Phase 1 handoff) |

## 6. Known limitations (free tier)

- The service sleeps after about 15 min without traffic. The first message after that waits for a cold start (about 1 min, see S-11). Telegram re-delivers the update; duplicates are ignored by `update_id`.
- 750 free instance-hours/month per workspace (S-12). One always-sleeping-when-idle service stays well below this.
- Logs are kept by Render only for a limited time; no persistent storage in Phase 1.
- `autoDeploy: true`: every push to `main` redeploys. Pushes to `main` happen only with Product Owner approval.

## 7. Rotation / incident

Token leaked → BotFather `/revoke` → update `TELEGRAM_BOT_TOKEN` on Render → redeploy.
Webhook secret leaked → new value on Render → redeploy (the webhook is re-registered at startup).

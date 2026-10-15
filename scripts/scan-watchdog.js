'use strict';

/** Missed-run detection for the daily scanner (workflow `scan-watchdog`). See src/jobs/scan.js. */

const { createSupabase } = require('../src/persistence/supabase');
const { createAnalysisStore } = require('../src/persistence/analysisStore');
const { createTelegramSender } = require('../src/telegram/send');
const { parseAllowedUserIds } = require('../src/config');
const { scanWatchdog } = require('../src/jobs/scan');

async function main() {
  const env = process.env;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_IDS']) {
    if (!env[k]) {
      console.error(`${k} must be set.`);
      process.exit(2);
    }
  }
  if (env.SEND_TEST === '1') {
    const sender = createTelegramSender({ token: env.TELEGRAM_BOT_TOKEN });
    const ids = [...parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS)];
    for (const id of ids) await sender.send(id, 'FVIS: mesaj de test din GitHub Actions — secretele Telegram funcționează.');
    console.log(`Test message sent to ${ids.length} chat(s).`);
    return;
  }
  const db = createSupabase({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const r = await scanWatchdog({
    store: createAnalysisStore(db),
    sender: createTelegramSender({ token: env.TELEGRAM_BOT_TOKEN }),
    chatIds: [...parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS)],
  });
  console.log(r.ok ? `Scanner ran on ${r.scanDate}.` : `No successful scanner run on ${r.scanDate}; alert sent to ${r.alerted} chat(s).`);
}

main().catch((err) => {
  console.error(`Watchdog aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});

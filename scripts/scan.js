'use strict';

/** Phase 5.2 daily scanner (second step of the `daily-sync` workflow). See src/jobs/scan.js. */

const fs = require('node:fs');
const { createSupabase } = require('../src/persistence/supabase');
const { createSupabaseCreditStore } = require('../src/persistence/repositories');
const { createAnalysisStore } = require('../src/persistence/analysisStore');
const { createCreditBudget } = require('../src/providers/oddsApi/creditBudget');
const { createTelegramSender } = require('../src/telegram/send');
const { parseAllowedUserIds } = require('../src/config');
const { createLogger } = require('../src/logging/logger');
const { scan } = require('../src/jobs/scan');

async function main() {
  const env = process.env;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_IDS']) {
    if (!env[k]) {
      console.error(`${k} must be set.`);
      process.exit(2);
    }
  }
  const logger = createLogger({ secrets: [env.TELEGRAM_BOT_TOKEN, env.SUPABASE_SERVICE_ROLE_KEY] });
  const db = createSupabase({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const budget = createCreditBudget({ store: createSupabaseCreditStore(db) });
  const report = await scan({
    store: createAnalysisStore(db),
    sender: createTelegramSender({ token: env.TELEGRAM_BOT_TOKEN }),
    chatIds: [...parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS)],
    usage: () => budget.usage(),
    logger,
  });
  const lines = [
    '# Scanner',
    '',
    `Scan date (Europe/Bucharest): ${report.scanDate}; status ${report.status}`,
    `Fixtures: considered ${report.considered}, analysed ${report.analyzed}, recorded ${report.recorded}, failed ${report.failed}`,
    `Line shopping (D-24): ${report.line && !report.line.error ? `evaluated ${report.line.evaluated}, rows inserted ${report.line.inserted}, failed ${report.line.failed}` : `ERROR ${report.line && report.line.error}`}`,
    `Digest: ${report.digest}; sent to ${report.sent} chat(s), send errors ${report.sendErrors}`,
  ];
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (report.status !== 'OK') process.exit(1);
}

main().catch((err) => {
  console.error(`Scanner aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});

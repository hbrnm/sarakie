'use strict';

/** Phase 2.3 daily sync (GitHub Actions workflow `daily-sync`). See src/jobs/dailySync.js. */

const fs = require('node:fs');
const { createFootballDataOrgAdapter } = require('../src/providers/footballDataOrg');
const { createOddsApiAdapter } = require('../src/providers/oddsApi');
const { createCreditBudget } = require('../src/providers/oddsApi/creditBudget');
const { createSupabase } = require('../src/persistence/supabase');
const { createRepositories, createSupabaseCreditStore } = require('../src/persistence/repositories');
const { dailySync } = require('../src/jobs/dailySync');

async function main() {
  const env = process.env;
  for (const k of ['FOOTBALL_DATA_ORG_KEY', 'ODDS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) {
      console.error(`${k} must be set.`);
      process.exit(2);
    }
  }
  const db = createSupabase({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const repo = createRepositories(db);
  const budget = createCreditBudget({ store: createSupabaseCreditStore(db) });
  const requests = [];
  const onRequest = (e) => {
    const h = e.headers;
    const num = (n) => (h && h.get(n) !== null && h.get(n) !== '' ? Number(h.get(n)) : null);
    requests.push({ ...e, at: new Date(), creditsLast: num('x-requests-last'), creditsRemaining: num('x-requests-remaining') });
  };
  const fd = createFootballDataOrgAdapter({ apiKey: env.FOOTBALL_DATA_ORG_KEY, onRequest });
  const odds = createOddsApiAdapter({ apiKey: env.ODDS_API_KEY, budget, onRequest });

  const report = await dailySync({ fd, odds, repo });
  await repo.insertRequestLog(requests);
  const usage = await budget.usage();

  const fmt = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v).replace(/\|/g, '/'));
  const lines = ['# Daily sync', '', '| Competition | Fixtures | Odds | Error |', '|---|---|---|---|'];
  for (const r of report) lines.push(`| ${r.code} | ${fmt(r.fixtures)} | ${fmt(r.odds)} | ${r.error || ''} |`);
  lines.push('', `Odds credits this month: ${usage.used} (scanner ${usage.scanner}, on-demand ${usage.on_demand}, other ${usage.other}); provider remaining: ${usage.providerRemaining ?? 'unknown'}`);
  lines.push(`Provider requests this run: ${requests.length}`);
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (report.some((r) => r.error)) process.exit(1);
}

main().catch((err) => {
  console.error(`Daily sync aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});

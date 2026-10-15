'use strict';

/**
 * Phase 6d line-shopping settlement (step of the `daily-sync` workflow):
 * 1. imports the current season's results and Pinnacle closing odds from football-data.co.uk
 *    (same code as backfill-history, idempotent; about 11 football-data.org requests, 0 odds credits);
 * 2. settles finished candidates with result, CLV and close-EV. See src/jobs/lineSettle.js.
 */

const fs = require('node:fs');
const { createFootballDataOrgAdapter } = require('../src/providers/footballDataOrg');
const { createFootballDataCoUkAdapter } = require('../src/providers/footballDataCoUk');
const { createSupabase } = require('../src/persistence/supabase');
const { createRepositories } = require('../src/persistence/repositories');
const { createAnalysisStore } = require('../src/persistence/analysisStore');
const { backfillHistory } = require('../src/jobs/backfillHistory');
const { lineSettle } = require('../src/jobs/lineSettle');

async function main() {
  const env = process.env;
  for (const k of ['FOOTBALL_DATA_ORG_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) {
      console.error(`${k} must be set.`);
      process.exit(2);
    }
  }
  const requests = [];
  const onRequest = (e) => requests.push({ ...e, at: new Date() });
  const db = createSupabase({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const repo = createRepositories(db);
  const imported = await backfillHistory({
    fd: createFootballDataOrgAdapter({ apiKey: env.FOOTBALL_DATA_ORG_KEY, onRequest }),
    uk: createFootballDataCoUkAdapter({ onRequest }),
    repo,
    currentSeasonOnly: true,
  });
  await repo.insertRequestLog(requests);
  const r = await lineSettle({ store: createAnalysisStore(db) });

  const lines = ['# Line-shopping settlement', '', '| League | Season | Closing odds inserted | Error |', '|---|---|---|---|'];
  for (const e of imported) lines.push(`| ${e.code} | ${e.season ?? '—'} | ${e.csv ? e.csv.closingInserted : '—'} | ${e.error || ''} |`);
  lines.push(
    '',
    `Unsettled candidates of final fixtures: ${r.pending}; settled now: ${r.settled} (with Pinnacle close: ${r.withClosing}); waiting for closing odds: ${r.waitingForClosing}`,
    `Results: WIN ${r.counts.WIN}, LOSS ${r.counts.LOSS}, VOID ${r.counts.VOID}`,
  );
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  // A failed import of one league does not block settlement, but the step is reported as failed.
  if (imported.some((e) => e.error)) process.exit(1);
}

main().catch((err) => {
  console.error(`Line settlement aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});

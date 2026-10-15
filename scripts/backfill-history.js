'use strict';

/**
 * Phase 2.2 history backfill (manual GitHub Actions workflow `backfill-history`).
 * Writes finished matches and closing odds for the previous and current season of the
 * 5 domestic leagues into Supabase. Safe to re-run.
 */

const { createFootballDataOrgAdapter } = require('../src/providers/footballDataOrg');
const { createFootballDataCoUkAdapter } = require('../src/providers/footballDataCoUk');
const { createSupabase } = require('../src/persistence/supabase');
const { createRepositories } = require('../src/persistence/repositories');
const { backfillHistory } = require('../src/jobs/backfillHistory');

async function main() {
  const { FOOTBALL_DATA_ORG_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!FOOTBALL_DATA_ORG_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('FOOTBALL_DATA_ORG_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(2);
  }
  const requests = [];
  const onRequest = (e) => requests.push({ ...e, at: new Date() });
  const fd = createFootballDataOrgAdapter({ apiKey: FOOTBALL_DATA_ORG_KEY, onRequest });
  const uk = createFootballDataCoUkAdapter({ onRequest });
  const repo = createRepositories(createSupabase({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }));

  const report = await backfillHistory({ fd, uk, repo });
  await repo.insertRequestLog(requests);

  const lines = ['# History backfill', '', '| League | Season | Teams | Results saved | CSV rows | Linked | Closing odds inserted | Already present | Unmatched CSV names | Error |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of report) {
    lines.push(`| ${r.code} | ${r.season ?? '—'} | ${r.teams ?? '—'} | ${r.results ? `${r.results.saved}/${r.results.received}` : '—'} | ${r.csv ? r.csv.rows : '—'} | ${r.csv ? r.csv.linked : '—'} | ${r.csv ? r.csv.closingInserted : '—'} | ${r.csv ? r.csv.closingEventsAlreadyPresent : '—'} | ${r.csv && r.csv.unmatchedNames.length ? r.csv.unmatchedNames.join(', ') : '—'} | ${r.error || ''} |`);
  }
  lines.push('', `Provider requests: ${requests.length}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (report.some((r) => r.error)) process.exit(1);
}

main().catch((err) => {
  console.error(`Backfill aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});

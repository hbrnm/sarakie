'use strict';

/** Phase 5.4 paper settlement (step of the `daily-sync` workflow). See src/jobs/settle.js. */

const fs = require('node:fs');
const { createSupabase } = require('../src/persistence/supabase');
const { createAnalysisStore } = require('../src/persistence/analysisStore');
const { settle } = require('../src/jobs/settle');

async function main() {
  const env = process.env;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) {
      console.error(`${k} must be set.`);
      process.exit(2);
    }
  }
  const db = createSupabase({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const r = await settle({ store: createAnalysisStore(db) });
  const lines = [
    '# Settlement',
    '',
    `Unsettled predictions of final fixtures: ${r.pending}; settled now: ${r.settled}`,
    `Results: WIN ${r.counts.WIN}, LOSS ${r.counts.LOSS}, PUSH ${r.counts.PUSH}, VOID ${r.counts.VOID}`,
    `Paper result of priced selections (all statuses, 1 unit each): ${r.paperProfit.toFixed(2)} over ${r.priced}`,
  ];
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

main().catch((err) => {
  console.error(`Settlement aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});

'use strict';

/**
 * Weekly backup (D-08, workflow `backup`).
 *   node scripts/backup.js export <dir>       export all tables (needs SUPABASE_* env)
 *   node scripts/backup.js restore-sql <dir>  print the psql restore + check script for <dir>
 */

const fs = require('node:fs');
const path = require('node:path');
const { createSupabase } = require('../src/persistence/supabase');
const { exportTables, restoreSql } = require('../src/jobs/backup');

async function main() {
  const [cmd, dir] = process.argv.slice(2);
  if (!dir || !['export', 'restore-sql'].includes(cmd)) {
    console.error('usage: node scripts/backup.js export|restore-sql <dir>');
    process.exit(2);
  }
  if (cmd === 'restore-sql') {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    process.stdout.write(restoreSql(manifest, dir));
    return;
  }
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!process.env[k]) {
      console.error(`${k} must be set.`);
      process.exit(2);
    }
  }
  const db = createSupabase({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
  const manifest = await exportTables({ db, outDir: dir });
  const lines = ['# Backup', '', '| Table | Rows |', '|---|---|', ...manifest.tables.map((t) => `| ${t.name} | ${t.rows} |`)];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

main().catch((err) => {
  console.error(`Backup aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});

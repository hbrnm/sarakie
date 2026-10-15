'use strict';

/**
 * Minimal in-memory stand-in for the subset of the supabase-js query builder used by
 * src/persistence: from().select/insert/upsert + eq/in/order, awaited as { data, error }.
 * Append-only tables reject updates the same way the real triggers do.
 */
const APPEND_ONLY = new Set(['odds_snapshots', 'odds_credit_ledger']);
const IDENTITY = new Set(['bookmakers', 'odds_snapshots', 'provider_request_log', 'odds_credit_ledger']);
const UUID_DEFAULT = new Set(['teams', 'fixtures']); // `default gen_random_uuid()` in the schema

function createFakeDb() {
  const tables = new Map();
  const seq = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  function from(name) {
    const state = { op: 'select', rows: null, onConflict: null, filters: [], returning: false };
    const builder = {
      select() {
        if (state.op === 'select') state.op = 'select';
        else state.returning = true;
        return builder;
      },
      insert(rows) {
        state.op = 'insert';
        state.rows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      upsert(rows, { onConflict }) {
        state.op = 'upsert';
        state.rows = Array.isArray(rows) ? rows : [rows];
        state.onConflict = onConflict.split(',');
        return builder;
      },
      eq(col, val) {
        state.filters.push((r) => r[col] === val);
        return builder;
      },
      in(col, vals) {
        state.filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      order() {
        return builder;
      },
      then(resolve, reject) {
        try {
          resolve(execute(name, state));
        } catch (err) {
          reject(err);
        }
      },
    };
    return builder;
  }

  function execute(name, s) {
    const t = table(name);
    if (s.op === 'select') return { data: t.filter((r) => s.filters.every((f) => f(r))).map((r) => ({ ...r })), error: null };
    const out = [];
    for (const row of s.rows) {
      const r = { ...row };
      if (IDENTITY.has(name) && r.id === undefined) {
        seq.set(name, (seq.get(name) || 0) + 1);
        r.id = seq.get(name);
      }
      if (UUID_DEFAULT.has(name) && r.id === undefined) r.id = require('node:crypto').randomUUID();
      if (s.op === 'upsert') {
        const existing = t.find((x) => s.onConflict.every((k) => x[k] === r[k]));
        if (existing) {
          if (APPEND_ONLY.has(name)) return { data: null, error: { message: 'append-only', code: '42501' } };
          Object.assign(existing, { ...r, id: existing.id });
          out.push({ ...existing });
          continue;
        }
      }
      t.push(r);
      out.push({ ...r });
    }
    return { data: s.returning ? out : null, error: null };
  }

  return { from, tables, table };
}

module.exports = { createFakeDb };

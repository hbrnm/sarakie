'use strict';

/**
 * Minimal in-memory stand-in for the subset of the supabase-js query builder used by
 * src/persistence: from().select/insert/upsert + eq/in/order, awaited as { data, error }.
 * Append-only tables reject updates the same way the real triggers do.
 */
const APPEND_ONLY = new Set(['odds_snapshots', 'odds_credit_ledger', 'model_versions', 'predictions', 'prediction_outcomes', 'explanations', 'scan_digests']);
const IDENTITY = new Set(['bookmakers', 'odds_snapshots', 'provider_request_log', 'odds_credit_ledger', 'model_versions', 'predictions', 'explanations']);
const UUID_DEFAULT = new Set(['teams', 'fixtures', 'analysis_runs']); // `default gen_random_uuid()` in the schema
// Unique keys enforced on insert (subset used by tests).
const UNIQUE = { scan_digests: ['scan_date'] };
// Upsert merges provided columns into the existing row, like ON CONFLICT DO UPDATE.

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
      upsert(rows, { onConflict, ignoreDuplicates = false }) {
        state.op = 'upsert';
        state.rows = Array.isArray(rows) ? rows : [rows];
        state.onConflict = onConflict.split(',');
        state.ignoreDuplicates = ignoreDuplicates;
        return builder;
      },
      update(values) {
        state.op = 'update';
        state.values = values;
        return builder;
      },
      range(from, to) {
        state.range = [from, to];
        return builder;
      },
      eq(col, val) {
        state.filters.push((r) => r[col] === val);
        return builder;
      },
      neq(col, val) {
        state.filters.push((r) => r[col] !== val);
        return builder;
      },
      gte(col, val) {
        state.filters.push((r) => r[col] >= val);
        return builder;
      },
      lt(col, val) {
        state.filters.push((r) => r[col] < val);
        return builder;
      },
      in(col, vals) {
        state.filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      order(col, { ascending = true } = {}) {
        state.order = { col, ascending };
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
    if (s.op === 'select') {
      const rows = t.filter((r) => s.filters.every((f) => f(r))).map((r) => ({ ...r }));
      if (s.order) rows.sort((a, b) => (a[s.order.col] < b[s.order.col] ? -1 : a[s.order.col] > b[s.order.col] ? 1 : 0) * (s.order.ascending ? 1 : -1));
      return { data: s.range ? rows.slice(s.range[0], s.range[1] + 1) : rows, error: null };
    }
    if (s.op === 'update') {
      if (APPEND_ONLY.has(name)) return { data: null, error: { message: 'append-only', code: '42501' } };
      for (const r of t.filter((x) => s.filters.every((f) => f(x)))) Object.assign(r, s.values);
      return { data: null, error: null };
    }
    const out = [];
    for (const row of s.rows) {
      const r = { ...row };
      if (IDENTITY.has(name) && r.id === undefined) {
        seq.set(name, (seq.get(name) || 0) + 1);
        r.id = seq.get(name);
      }
      if (UUID_DEFAULT.has(name) && r.id === undefined) r.id = require('node:crypto').randomUUID();
      if (s.op === 'insert' && UNIQUE[name] && t.some((x) => UNIQUE[name].every((k) => x[k] === r[k]))) {
        return { data: null, error: { message: 'duplicate key', code: '23505' } };
      }
      if (s.op === 'upsert') {
        const existing = t.find((x) => s.onConflict.every((k) => x[k] === r[k]));
        if (existing) {
          if (s.ignoreDuplicates) continue;
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

'use strict';

const { createClient } = require('@supabase/supabase-js');

/**
 * Server-side Supabase client using the service role (bypasses RLS).
 * Never construct this in code that could run on a client.
 * @param {{ url: string, serviceRoleKey: string }} options
 */
function createSupabase({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Throws on a Supabase error; returns data otherwise. Error text never contains the key. */
function unwrap({ data, error }, what) {
  if (error) {
    const err = new Error(`database error during ${what}: ${error.message}`);
    err.code = 'DB_ERROR';
    err.dbCode = error.code;
    throw err;
  }
  return data;
}

module.exports = { createSupabase, unwrap };

/**
 * Shared Supabase admin client for Netlify Functions that need service_role
 * access (server-side writes bypassing RLS).
 *
 * Env vars required for production:
 *   SUPABASE_URL (or VITE_SUPABASE_URL) — project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service_role key (NEVER exposed to frontend)
 *
 * Without SUPABASE_SERVICE_ROLE_KEY, getAdminClient() returns null.
 * Functions should fall back to a test-mode response in that case.
 *
 * This file is NOT deployed as a standalone Netlify function — it is
 * require()d by other function modules.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _adminClient = null;

/**
 * Returns a Supabase client initialized with the service_role key.
 * The client is cached across warm invocations of the Lambda instance.
 * Returns null when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are not set.
 */
const getAdminClient = () => {
  if (_adminClient) return _adminClient;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _adminClient;
};

module.exports = { getAdminClient, SUPABASE_URL };

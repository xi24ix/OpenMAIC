'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseConfig } from './config';

let client: SupabaseClient | undefined;

/** Return the one browser client used by the auth UI and session provider. */
export function getSupabaseBrowserClient(): SupabaseClient | undefined {
  if (client) return client;

  const config = getSupabaseConfig();
  if (!config) return undefined;

  client = createBrowserClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });
  return client;
}

import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseConfig } from './config';

export interface SupabaseSessionResult {
  readonly response: NextResponse;
  readonly user: User | null;
}

/**
 * Refresh the Supabase session before a page or API route runs. Keeping this in
 * middleware makes the auth cookies readable by the existing owner-identity
 * seam and prevents an expired access token from looking like a random logout.
 */
export async function updateSupabaseSession(
  request: NextRequest,
  createResponse: () => NextResponse,
): Promise<SupabaseSessionResult> {
  const config = getSupabaseConfig();
  if (!config) return { response: createResponse(), user: null };

  let response = createResponse();
  const supabase = createServerClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = createResponse();
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

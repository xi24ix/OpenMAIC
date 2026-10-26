import { createServerClient } from '@supabase/ssr';

import { getSupabaseConfig } from '@/lib/supabase/config';

import type { OwnerAuthMethod, OwnerAuthMethodResult, OwnerAuthRequest } from './types';

const SUPABASE_OWNER_PREFIX = 'supabase:';
const SUPABASE_OWNER_ID =
  /^supabase:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function requestCookies(request: OwnerAuthRequest): Array<{ name: string; value: string }> {
  return (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return [];
      return [
        {
          name: part.slice(0, separator),
          value: decodeCookieValue(part.slice(separator + 1)),
        },
      ];
    });
}

function hasSupabaseAuthCookie(cookies: Array<{ name: string; value: string }>): boolean {
  return cookies.some((cookie) => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name));
}

async function authenticate(request: OwnerAuthRequest): Promise<OwnerAuthMethodResult> {
  const config = getSupabaseConfig();
  if (!config) return { status: 'not-applicable' };

  const cookies = requestCookies(request);
  if (!hasSupabaseAuthCookie(cookies)) return { status: 'not-applicable' };

  const supabase = createServerClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    cookies: {
      getAll: () => cookies,
      setAll: () => undefined,
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { status: 'invalid', reason: error?.message ?? 'Supabase session has no user' };
  }

  return {
    status: 'authenticated',
    principal: {
      ownerId: `${SUPABASE_OWNER_PREFIX}${data.user.id}`,
      kind: 'user',
      roles: new Set<string>(),
      assurance: 'verified',
      channel: 'supabase-email-otp',
    },
  };
}

/** Supabase Auth identity adapter for OpenMAIC's owner-scoped persistence. */
export function supabaseAuthMethod(): OwnerAuthMethod {
  return {
    name: 'supabaseAuth',
    authenticate,
    describeStoredOwner(ownerId) {
      if (!SUPABASE_OWNER_ID.test(ownerId)) return undefined;
      return { kind: 'user', roles: new Set<string>() };
    },
  };
}

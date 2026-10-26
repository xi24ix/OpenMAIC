export interface SupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim() !== '')?.trim();
}

/**
 * Public Supabase configuration shared by the browser, middleware and server.
 * The publishable/legacy anon key is intentionally safe to expose to the
 * browser; database access is still enforced by Supabase Auth + RLS.
 */
export function getSupabaseConfig(): SupabaseConfig | undefined {
  const url = firstNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL);
  const publishableKey = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
  );

  if (!url || !publishableKey) return undefined;
  return { url, publishableKey };
}

export function isSupabaseAuthConfigured(): boolean {
  return getSupabaseConfig() !== undefined;
}

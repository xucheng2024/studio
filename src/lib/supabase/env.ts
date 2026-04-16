/** Resolve public Supabase credentials (supports both legacy anon JWT and publishable key names). */
export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/** True when public URL + anon (or publishable) key are set — required for SSR auth and data. */
export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl()?.trim() && getSupabaseAnonKey()?.trim());
}

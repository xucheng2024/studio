import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from "@/lib/supabase/env";

let browserSupabase: SupabaseClient | null = null;

export function createBrowserSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (set them in Vercel Environment Variables).",
    );
  }
  if (!browserSupabase) {
    browserSupabase = createBrowserClient(getSupabaseUrl()!, getSupabaseAnonKey()!, {
      auth: {
        autoRefreshToken: false,
      },
    });
  }
  return browserSupabase;
}

export async function getBrowserSession() {
  const supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export async function getBrowserUser() {
  const supabase = createBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

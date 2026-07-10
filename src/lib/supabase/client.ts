import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from "@/lib/supabase/env";

let browserSupabase: SupabaseClient | null = null;

function isInvalidRefreshTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Invalid Refresh Token") || message.includes("Refresh Token Not Found");
}

async function clearInvalidBrowserSession(supabase: SupabaseClient, error: unknown) {
  if (!isInvalidRefreshTokenError(error)) return false;
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* ignore local cleanup failures */
  }
  return true;
}

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
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    await clearInvalidBrowserSession(supabase, error);
    return null;
  }
  return data.session ?? null;
}

export async function getBrowserUser() {
  const supabase = createBrowserSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    await clearInvalidBrowserSession(supabase, error);
    return null;
  }
  return user ?? null;
}

export async function refreshBrowserSession() {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    await clearInvalidBrowserSession(supabase, error);
    return null;
  }
  return data.session ?? null;
}

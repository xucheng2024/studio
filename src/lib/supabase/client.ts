import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export function createBrowserSupabase() {
  return createBrowserClient(getSupabaseUrl()!, getSupabaseAnonKey()!);
}

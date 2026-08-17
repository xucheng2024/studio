import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertLoopbackUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTNAMES.has(hostname)) throw new Error(`Refuse non-local ${label}: ${hostname}`);
  return url;
}

export function assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl }) {
  assertLoopbackUrl(baseUrl, "app URL");
  assertLoopbackUrl(supabaseUrl, "Supabase API URL");
  assertLoopbackUrl(databaseUrl, "Supabase database URL");
}

// Auth redirect allow-lists commonly omit local UAT ports.  Build the same
// SSR session cookies directly from a locally-issued OTP instead of visiting it.
export async function createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }) {
  assertLoopbackUrl(baseUrl, "app URL");
  assertLoopbackUrl(supabaseUrl, "Supabase API URL");
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: identity.email });
  if (linkError) throw linkError;
  const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (verifyError) throw verifyError;
  if (!verified.session || verified.user?.id !== identity.id) throw new Error(`Local session identity mismatch for ${identity.email}`);

  let cookies = [];
  const server = createServerClient(supabaseUrl, anonKey, {
    cookies: { getAll: () => [], setAll: (values) => { cookies = values; } },
  });
  const { error: sessionError } = await server.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (sessionError) throw sessionError;
  return cookies.map(({ name, value }) => ({ name, value, url: baseUrl }));
}

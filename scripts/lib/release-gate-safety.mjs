const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requiredEnvironment(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required release environment: ${name}`);
  return value;
}

export function assertReleaseStudioId(value, name) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
  return value;
}

export function assertReleaseSupabaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("RELEASE_SUPABASE_URL must be a credential-free HTTPS project origin");
  }
  if (!/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) {
    throw new Error("RELEASE_SUPABASE_URL must target a hosted Supabase project");
  }
  return url.origin;
}

export function assertVercelCandidateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("RELEASE_CANDIDATE_URL must be a credential-free HTTPS deployment origin");
  }
  if (!/^[a-z0-9-]+\.vercel\.app$/i.test(url.hostname)) {
    throw new Error("RELEASE_CANDIDATE_URL must be a direct Vercel deployment URL");
  }
  return url.origin;
}

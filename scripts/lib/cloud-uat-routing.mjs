const SHARED_PATH_PREFIXES = [
  "package.json",
  "package-lock.json",
  "supabase/config.toml",
  "supabase/migrations/",
  "scripts/lib/local-supabase-uat.mjs",
  "scripts/manage-cloud-vm-uat-environment.mjs",
];

const FAST_SCRIPTS = {
  "apt04-appointments-local": "test:apt04-app",
  "com01-commission-local": "test:local-uat-safety",
  "crm02-clients-local": "test:crm02-app",
  "mkt01-marketing-local": "test:mkt02-marketing-contract",
  "pos-packages-local": "test:pos-pkg-browser-guard",
};

export const CLOUD_UAT_FLOW_ORDER = Object.freeze(Object.keys(FAST_SCRIPTS));

function matchesPath(path, pattern) {
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -2));
  return path === pattern;
}

export function routeCloudUatChanges(changedPaths, flows) {
  const paths = [...new Set(changedPaths.map((value) => value.replace(/^\.\//, "")).filter(Boolean))];
  const available = new Map(flows.map((flow) => [flow.id, flow]));
  const shared = paths.some((path) => SHARED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)));
  const selected = shared
    ? CLOUD_UAT_FLOW_ORDER.filter((id) => available.has(id))
    : CLOUD_UAT_FLOW_ORDER.filter((id) => available.get(id)?.paths?.some((pattern) => paths.some((path) => matchesPath(path, pattern))));
  return {
    changedPaths: paths,
    flows: selected,
    dispatch: selected.length === 0 ? null : selected.length === 1 ? selected[0] : "all",
    reason: shared ? "shared_local_uat_infrastructure" : selected.length ? "feature_paths" : "no_declared_uat_path",
    fastMatrix: { include: selected.map((flow) => ({ flow, script: FAST_SCRIPTS[flow] })) },
  };
}

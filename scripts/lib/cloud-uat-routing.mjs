const SHARED_PATH_PREFIXES = [
  "package.json",
  "package-lock.json",
  "supabase/config.toml",
  "supabase/migrations/",
  "scripts/lib/local-supabase-uat.mjs",
  "scripts/manage-cloud-vm-uat-environment.mjs",
];

export const FAST_SCRIPTS = Object.freeze({
  "apt01-availability-local": "test:apt01-static-gates",
  "apt03-calendar-local": "test:apt03-app",
  "apt04-appointments-local": "test:apt04-app",
  "apt04-settlement-sandbox-local": "test:apt04-app",
  "com01-commission-local": "test:local-uat-safety",
  "crm02-clients-local": "test:crm02-app",
  "mkt01-marketing-local": "test:mkt02-marketing-contract",
  "pos02-cash-receipt-local": "test:local-uat-safety",
  "pos03-hitpay-sandbox-local": "test:hitpay-merchant-mode",
  "pkg01-package-ledger-local": "test:local-uat-safety",
  "pos-packages-local": "test:pos-pkg-browser-guard",
});

export const CLOUD_UAT_FLOW_ORDER = Object.freeze(Object.keys(FAST_SCRIPTS));
export const CATALOG_FAST_SCRIPT = "test:cloud-uat-options";
export const CATALOG_PATH_PREFIXES = Object.freeze([
  "uat.flows.json",
  "scripts/lib/cloud-uat-routing.mjs",
  "scripts/run-github-hosted-uat.mjs",
  "scripts/tests/cloud-uat-catalog.test.mjs",
  "scripts/tests/cloud-uat-options.test.mjs",
  "scripts/tests/cloud-uat-routing.test.mjs",
  ".github/workflows/free-cloud-uat.yml",
  ".github/workflows/release-gate.yml",
]);

function matchesPath(path, pattern) {
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -2));
  return path === pattern;
}

export function routeCloudUatChanges(changedPaths, flows) {
  const paths = [...new Set(changedPaths.map((value) => value.replace(/^\.\//, "")).filter(Boolean))];
  const available = new Map(flows.map((flow) => [flow.id, flow]));
  const shared = paths.some((path) => SHARED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)));
  const catalog = paths.some((path) => CATALOG_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)));
  const selected = shared
    ? CLOUD_UAT_FLOW_ORDER.filter((id) => available.has(id))
    : CLOUD_UAT_FLOW_ORDER.filter((id) => available.get(id)?.paths?.some((pattern) => paths.some((path) => matchesPath(path, pattern))));
  const include = selected.map((flow) => ({ flow, script: FAST_SCRIPTS[flow] }));
  if (catalog) include.unshift({ flow: "cloud-uat-catalog", script: CATALOG_FAST_SCRIPT });
  return {
    changedPaths: paths,
    flows: selected,
    dispatch: selected.length === 0 ? null : selected.length === 1 ? selected[0] : "all",
    reason: shared ? "shared_local_uat_infrastructure" : selected.length ? "feature_paths" : catalog ? "cloud_uat_catalog" : "no_declared_uat_path",
    fastMatrix: { include },
  };
}

#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FLOW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-local$/;
const ENV_LIFECYCLE = {
  start: ["node", "scripts/manage-cloud-vm-uat-environment.mjs", "start"],
  ready: ["node", "scripts/manage-cloud-vm-uat-environment.mjs", "ready"],
  inspect: ["node", "scripts/manage-cloud-vm-uat-environment.mjs", "inspect"],
  cleanup: ["node", "scripts/manage-cloud-vm-uat-environment.mjs", "cleanup"],
  cleanup_on_failure: false,
};

export function parseArgs(argv) {
  const args = { write: false, root: process.cwd(), fastScript: "test:local-uat-safety", readyPath: "/dashboard", port: 3112 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") args.write = true;
    else if (token === "--id") args.id = argv[++i];
    else if (token === "--after") args.after = argv[++i];
    else if (token === "--fast-script") args.fastScript = argv[++i];
    else if (token === "--ready-path") args.readyPath = argv[++i];
    else if (token === "--port") args.port = Number(argv[++i]);
    else if (token === "--root") args.root = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.id || !FLOW_ID.test(args.id)) throw new Error("Usage: --id <slug>-local [--after <flow-id>] [--fast-script test:...] [--write]");
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) throw new Error("--port must be a local TCP port");
  return args;
}

export function namesForFlow(id) {
  const kebab = id.replace(/-local$/, "");
  const token = kebab.split("-")[0];
  const env = `${token.toUpperCase()}_UAT`;
  return {
    id,
    kebab,
    token,
    env,
    npmScript: `test:${kebab}-uat-local`,
    runner: `scripts/run-${kebab}-uat-local.mjs`,
    verifier: `scripts/verify-${kebab}-browser-local.mjs`,
    sql: `scripts/sql/${kebab.replace(/-/g, "_")}_uat_local_execute.sql`,
    identities: `scripts/fixtures/${token}-local-identities.mjs`,
    evidenceDir: `tmp/${kebab}-uat`,
  };
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function write(root, rel, contents) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function replaceBraceBlock(source, prefix, next) {
  const start = source.indexOf(prefix);
  if (start === -1) throw new Error(`missing ${prefix}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`unclosed block for ${prefix}`);
  return `${source.slice(0, brace)}${next}${source.slice(end + 1)}`;
}

function insertAfter(list, afterId, id) {
  if (list.includes(id)) return [...list];
  if (!afterId) return [...list, id];
  const index = list.indexOf(afterId);
  if (index === -1) throw new Error(`Unknown --after flow: ${afterId}`);
  return [...list.slice(0, index + 1), id, ...list.slice(index + 1)];
}

function canonicalUuid(seed, n) {
  const hex = createHash("sha1").update(`${seed}:${n}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function extractCatalog(root) {
  const routing = read(root, "scripts/lib/cloud-uat-routing.mjs");
  const match = routing.match(/export const FAST_SCRIPTS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (!match) throw new Error("FAST_SCRIPTS block missing");
  const scripts = Object.fromEntries(
    [...match[1].matchAll(/"([^"]+)": "([^"]+)"/g)].map((entry) => [entry[1], entry[2]]),
  );
  const freeCloud = read(root, ".github/workflows/free-cloud-uat.yml");
  const options = freeCloud
    .match(/\n {8}options:\n((?: {10}- .+\n)+)/)[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}- /, "").trim())
    .filter(Boolean);
  const matrix = JSON.parse(freeCloud.match(/inputs\.flow == 'all' && '(\[[^\]]+\])'/)[1]);
  const maxParallel = Number(freeCloud.match(/max-parallel:\s*(\d+)/)[1]);
  const release = read(root, ".github/workflows/release-gate.yml")
    .match(/flows=\(\n((?:[ \t]+[a-z0-9-]+\n)+)[ \t]+\)/)[1]
    .trim()
    .split(/\s+/);
  const releaseMatrix = read(root, ".github/workflows/release-gate.yml")
    .match(/\n {6}matrix:\n {8}flow:\n((?: {10}- [a-z0-9-]+\n)+)/)[1]
    .trim()
    .split(/\n/)
    .map((line) => line.replace(/^ *- /, "").trim());
  const manifest = JSON.parse(read(root, "uat.flows.json"));
  const isolated = (manifest.flows ?? [])
    .filter((flow) => flow.target?.policy === "command_local" && flow.data_access?.policy === "local_only")
    .map((flow) => flow.id);
  return { scripts, order: Object.keys(scripts), options, matrix, maxParallel, release, releaseMatrix, isolated };
}

function renderFastScripts(scripts, order) {
  return `{\n${order.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(scripts[id])},`).join("\n")}\n}`;
}

function applyCatalogFiles(root, { id, after, fastScript, names, npmScript }) {
  const current = extractCatalog(root);
  if (current.order.includes(id)) return { status: "already_wired", order: current.order };
  const afterId = after ?? current.order.at(-1);
  const order = insertAfter(current.order, afterId, id);
  const scripts = { ...current.scripts, [id]: fastScript };

  const routingPath = "scripts/lib/cloud-uat-routing.mjs";
  write(root, routingPath, replaceBraceBlock(read(root, routingPath), "export const FAST_SCRIPTS = Object.freeze(", renderFastScripts(scripts, order)));

  let freeCloud = read(root, ".github/workflows/free-cloud-uat.yml");
  const options = `${order.map((flow) => `          - ${flow}`).join("\n")}\n          - all\n          - all-batched\n`;
  freeCloud = freeCloud.replace(/\n {8}options:\n(?: {10}- .+\n)+/, `\n        options:\n${options}`);
  freeCloud = freeCloud.replace(/max-parallel:\s*\d+/, `max-parallel: ${order.length}`);
  freeCloud = freeCloud.replace(/inputs\.flow == 'all' && '\[[^\]]+\]'/, `inputs.flow == 'all' && '${JSON.stringify(order)}'`);
  write(root, ".github/workflows/free-cloud-uat.yml", freeCloud);

  let release = read(root, ".github/workflows/release-gate.yml");
  const flowsBlock = order.map((flow) => `            ${flow}`).join("\n");
  const matrixBlock = order.map((flow) => `          - ${flow}`).join("\n");
  release = release.replace(/flows=\(\n(?:[ \t]+[a-z0-9-]+\n)+[ \t]+\)/, `flows=(\n${flowsBlock}\n          )`);
  release = release.replace(/\n {6}matrix:\n {8}flow:\n(?: {10}- [a-z0-9-]+\n)+/, `\n      matrix:\n        flow:\n${matrixBlock}\n`);
  write(root, ".github/workflows/release-gate.yml", release);

  const manifest = JSON.parse(read(root, "uat.flows.json"));
  const index = manifest.flows.findIndex((flow) => flow.id === afterId);
  if (index === -1) throw new Error(`Cannot insert after ${afterId}`);
  manifest.flows.splice(index + 1, 0, {
    id,
    paths: [names.runner, names.verifier, names.sql, names.identities, "scripts/lib/local-fixture-auth.mjs", "scripts/lib/local-uat-safety.mjs", "scripts/lib/local-supabase-uat.mjs"],
    command: ["npm", "run", npmScript],
    target: { policy: "command_local" },
    data_access: { policy: "local_only" },
    requirements: { commands: ["node", "npm", "npx", "psql"], services: ["docker"] },
    environment: ENV_LIFECYCLE,
    evidence: {
      run_id_env: "UAT_FLOW_RUN_ID",
      directories: [names.evidenceDir],
      index: `${names.evidenceDir}/{run_id}/index.json`,
      index_schema: "uat-evidence-v1",
    },
  });
  write(root, "uat.flows.json", `${JSON.stringify(manifest, null, 2)}\n`);

  const packageJson = read(root, "package.json");
  if (!packageJson.includes(`"${npmScript}"`)) {
    write(
      root,
      "package.json",
      packageJson.replace(
        `"test:cloud-uat-options":`,
        `"${npmScript}": "node ${names.runner}",\n    "test:cloud-uat-options":`,
      ),
    );
  }

  const routingTestPath = "scripts/tests/cloud-uat-routing.test.mjs";
  let routingTest = read(root, routingTestPath);
  if (!routingTest.includes(`id: "${id}"`)) {
    const entry = `  { id: "${id}", paths: ["${names.verifier}"] },\n`;
    const afterPattern = new RegExp(`(\\{ id: "${afterId}"[^\\n]*\\},\\n)`);
    routingTest = afterPattern.test(routingTest)
      ? routingTest.replace(afterPattern, `$1${entry}`)
      : routingTest.replace("];", `${entry}];`);
    write(root, routingTestPath, routingTest);
  }

  return { status: "wired", order };
}

function stubFiles(names, { port, readyPath, id }) {
  const ownerId = canonicalUuid(id, 1);
  const instructorId = canonicalUuid(id, 2);
  const ownerEmail = `${names.token}-local-owner@example.test`;
  const instructorEmail = `${names.token}-local-instructor@example.test`;
  return {
    [names.identities]: `export const ${names.token.toUpperCase()}_LOCAL_IDENTITIES = Object.freeze({
  owner: { id: "${ownerId}", email: "${ownerEmail}" },
  instructor: { id: "${instructorId}", email: "${instructorEmail}" },
});

export const ${names.token.toUpperCase()}_LOCAL_IDENTITY_LIST = Object.freeze(Object.values(${names.token.toUpperCase()}_LOCAL_IDENTITIES));
`,
    [names.sql]: `\\set ON_ERROR_STOP on

select set_config('${names.token}_uat.studio_id', :'${names.env.toLowerCase()}_studio_id', false);
select set_config('${names.token}_uat.location_id', :'${names.env.toLowerCase()}_location_id', false);

do $$
declare
  v_studio uuid := current_setting('${names.token}_uat.studio_id')::uuid;
  v_location uuid := current_setting('${names.token}_uat.location_id')::uuid;
  v_owner uuid := '${ownerId}';
  v_instructor uuid := '${instructorId}';
begin
  if exists (
    select 1 from (values
      (v_owner, '${ownerEmail}'), (v_instructor, '${instructorEmail}')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception '${names.token} local fixture requires exact local Auth identities'; end if;

  insert into public.users (id, email) values
    (v_owner, '${ownerEmail}'), (v_instructor, '${instructorEmail}')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, '${ownerEmail}', '${names.token} local owner', 'member'),
    (v_instructor, '${instructorEmail}', '${names.token} local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.studios (id, owner_id, name, public_slug, contract_status)
    values (v_studio, v_owner, '${names.token} local UAT', '${names.token}-local-' || left(v_studio::text, 8), 'active');
  insert into public.locations (id, studio_id, name, is_active)
    values (v_location, v_studio, '${names.token} Local', true);
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active)
    values (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true);
end $$;
`,
    [names.runner]: `import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ${names.token.toUpperCase()}_LOCAL_IDENTITY_LIST } from "./fixtures/${names.token}-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.${names.env}_PORT || "${port}");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("${names.env}_PORT must be a valid local port");
const status = readLocalSupabaseStatus();
const baseUrl = \`http://127.0.0.1:\${port}\`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });
const fixture = {
  ${names.env}_RUN_ID: process.env.UAT_FLOW_RUN_ID || \`local-\${Date.now()}\`,
  ${names.env}_STUDIO_ID: randomUUID(),
  ${names.env}_LOCATION_ID: randomUUID(),
};
const env = localSupabaseEnvironment(status, {
  ${names.env}_BASE_URL: baseUrl,
  ${names.env}_DB_URL: status.DB_URL,
  NEXT_PUBLIC_APP_URL: baseUrl,
  ...fixture,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, ${names.token.toUpperCase()}_LOCAL_IDENTITY_LIST, "${names.token} local fixture");
const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", \`\${key.toLowerCase()}=\${value}\`]);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "${names.sql}"], { stdio: "inherit", env });
process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: ${JSON.stringify(readyPath)},
  command: ["node", "${names.verifier}"],
});
`,
    [names.verifier]: `import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ${names.token.toUpperCase()}_LOCAL_IDENTITIES } from "./fixtures/${names.token}-local-identities.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = ["${names.env}_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "${names.env}_DB_URL", "${names.env}_STUDIO_ID", "${names.env}_LOCATION_ID", "${names.env}_RUN_ID"];
for (const key of required) if (!process.env[key]) throw new Error(\`Missing local ${names.token} UAT environment: \${key}\`);
const baseUrl = process.env.${names.env}_BASE_URL;
assertLocalUatTargets({ baseUrl, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, databaseUrl: process.env.${names.env}_DB_URL });
const studioId = process.env.${names.env}_STUDIO_ID;
const locationId = process.env.${names.env}_LOCATION_ID;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    identity: ${names.token.toUpperCase()}_LOCAL_IDENTITIES.owner,
    baseUrl,
  }));
  const page = await context.newPage();
  await page.goto(\`\${baseUrl}${readyPath}?studio_id=\${studioId}&location_id=\${locationId}\`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "${names.token} mobile overflow");
  throw new Error("Fill ${names.verifier} with feature assertions before running this UAT flow");
} finally {
  await browser.close();
}
`,
  };
}

export function scaffoldIsolatedUatFlow(options) {
  const names = namesForFlow(options.id);
  const current = extractCatalog(options.root);
  if (current.order.includes(options.id)) {
    return { status: "already_wired", flow: options.id, names };
  }
  const files = stubFiles(names, options);
  if (!options.write) {
    return { status: "planned", flow: options.id, names, files: Object.keys(files) };
  }
  const catalog = applyCatalogFiles(options.root, {
    id: options.id,
    after: options.after,
    fastScript: options.fastScript,
    names,
    npmScript: names.npmScript,
  });
  for (const [rel, contents] of Object.entries(files)) {
    if (!fs.existsSync(path.join(options.root, rel))) write(options.root, rel, contents);
  }
  return { status: catalog.status, flow: options.id, names, order: catalog.order, files: Object.keys(files) };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = scaffoldIsolatedUatFlow(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

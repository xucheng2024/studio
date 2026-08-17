import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { supabaseStartExcludeArgs, validateDockerImageList } from "../lib/github-uat-optimization.mjs";

test("cloud UAT catalog recommends only the supported first-release path", () => {
  const output = execFileSync("node", ["scripts/show-cloud-uat-options.mjs", "--json"], { encoding: "utf8" });
  const catalog = JSON.parse(output);

  assert.equal(catalog.version, 1);
  assert.equal(catalog.default_provider, "github-actions");
  assert.deepEqual(catalog.providers.map(({ id }) => id), ["github-actions"]);
  assert.ok(catalog.providers.every(({ recommended }) => recommended));
  assert.ok(catalog.providers.every(({ free_tier }) => free_tier.length > 0));
});

test("GitHub UAT runner refuses to run outside GitHub Actions", () => {
  const result = spawnSync("node", ["scripts/run-github-hosted-uat.mjs", "--flow", "apt04-appointments-local"], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "false" },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must run on a Linux GitHub Actions runner/);
});

test("GitHub UAT optimization excludes only optional Supabase services", () => {
  assert.deepEqual(supabaseStartExcludeArgs("studio,realtime,studio"), ["--exclude", "studio,realtime"]);
  assert.throws(() => supabaseStartExcludeArgs("gotrue"), /unsupported services/);
  assert.throws(() => supabaseStartExcludeArgs("postgres"), /unsupported services/);
});

test("Docker image cache manifest accepts image references but not arguments", () => {
  assert.deepEqual(validateDockerImageList(["supabase/postgres:17.6", "public.ecr.aws/supabase/kong:2.8"]), [
    "supabase/postgres:17.6",
    "public.ecr.aws/supabase/kong:2.8",
  ]);
  assert.throws(() => validateDockerImageList(["--output=/tmp/file"]), /invalid image reference/);
});

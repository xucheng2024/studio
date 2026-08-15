import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function run(env: NodeJS.ProcessEnv) {
  return spawnSync("node", ["scripts/verify-pos-pkg-browser.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("POS/Package browser UAT refuses an implicit production target", () => {
  const result = run({ POS_PKG_BASE_URL: undefined, POS_PKG_ALLOW_REMOTE_UAT: undefined });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /POS_PKG_BASE_URL is required/);
});

test("POS/Package browser UAT requires explicit remote authorization", () => {
  const result = run({ POS_PKG_BASE_URL: "https://example.com", POS_PKG_ALLOW_REMOTE_UAT: undefined });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /POS_PKG_ALLOW_REMOTE_UAT=1/);
});

import { spawnSync } from "node:child_process";

const result = spawnSync(
  "node",
  ["--experimental-strip-types", "--test", "scripts/tests/apt05-app-contract.test.ts"],
  { stdio: "inherit" },
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);

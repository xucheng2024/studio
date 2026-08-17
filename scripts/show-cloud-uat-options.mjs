#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const catalogPath = path.join(process.cwd(), "cloud-uat.providers.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(catalog)}\n`);
  process.exit(0);
}

console.log("Recommended free cloud UAT option\n");
for (const provider of catalog.providers) {
  const suffix = provider.id === catalog.default_provider ? " (default)" : "";
  console.log(`${provider.name}${suffix}`);
  console.log(`  Best for: ${provider.best_for}`);
  console.log(`  Why: ${provider.reason}`);
  console.log(`  Free tier: ${provider.free_tier}`);
  console.log(`  Start: ${provider.setup.url}\n`);
}

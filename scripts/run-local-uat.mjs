#!/usr/bin/env node
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const flow = value("--flow", "apt04");
const port = Number(value("--port", "3104"));
const engines = value("--engines", "chrome");
if (flow !== "apt04" || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/run-local-uat.mjs --flow apt04 [--port 3104] [--engines chrome]");
}

const status = readLocalSupabaseStatus();
const env = localSupabaseEnvironment(status, {
  APT04_UAT_BASE_URL: `http://127.0.0.1:${port}`,
  APT04_UAT_RUN_ID: `local-${Date.now()}`,
  APT04_UAT_ENGINES: engines,
});

process.exitCode = await runLocalNextUat({ port, env, command: ["npm", "run", "test:apt04-uat-local"] });

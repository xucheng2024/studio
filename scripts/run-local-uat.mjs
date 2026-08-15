#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";

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

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "--output", "json"], { encoding: "utf8" }));
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  APT04_UAT_BASE_URL: `http://127.0.0.1:${port}`,
  APT04_UAT_RUN_ID: `local-${Date.now()}`,
  APT04_UAT_ENGINES: engines,
};

function ready() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}`, (response) => {
      response.resume();
      resolve(response.statusCode && response.statusCode < 500);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => request.destroy());
  });
}

async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Local app did not become ready on port ${port}`);
}

const app = spawn("npm", ["run", "dev", "--", "--port", String(port)], { env, stdio: "inherit" });
try {
  await waitForApp();
  const test = spawn("npm", ["run", "test:apt04-uat-local"], { env, stdio: "inherit" });
  const code = await new Promise((resolve) => test.once("exit", (exitCode) => resolve(exitCode ?? 1)));
  process.exitCode = code;
} finally {
  app.kill("SIGTERM");
}

import { execFileSync, spawn } from "node:child_process";
import http from "node:http";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

function assertLoopbackUrl(value, label) {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTNAMES.has(hostname)) throw new Error(`Refuse non-local ${label}: ${hostname}`);
}

export function validateLocalSupabaseStatus(status) {
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"]) {
    if (!status?.[key]) throw new Error(`Local Supabase status is missing ${key}`);
  }
  assertLoopbackUrl(status.API_URL, "Supabase API URL");
  assertLoopbackUrl(status.DB_URL, "Supabase database URL");
  return status;
}

export function readLocalSupabaseStatus() {
  let raw;
  try {
    raw = execFileSync("npx", ["--no-install", "supabase", "status", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Local Supabase status is unavailable");
  }
  try {
    return validateLocalSupabaseStatus(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Local Supabase status is invalid");
    throw error;
  }
}

export function localSupabaseEnvironment(status, extra = {}) {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    ...extra,
  };
}

export async function waitForLocalDatabaseState(read, isReady, label, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("Local database wait timeout and interval must be positive integers");
  }
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (isReady(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

export function isAppReadyStatus(statusCode) {
  return Boolean(statusCode && statusCode >= 200 && statusCode < 400);
}

function waitForApp(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(isAppReadyStatus(response.statusCode));
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => request.destroy());
  });
}

export async function runLocalNextUat({ port, env, command, readyPath = "/" }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const readyUrl = new URL(readyPath, baseUrl);
  const app = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "inherit" });
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await waitForApp(readyUrl)) break;
      if (attempt === 59) throw new Error(`Local app did not become ready at ${readyUrl.pathname} on port ${port}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const test = spawn(command[0], command.slice(1), { env, stdio: "inherit" });
    return await new Promise((resolve) => test.once("exit", (exitCode) => resolve(exitCode ?? 1)));
  } finally {
    app.kill("SIGTERM");
  }
}

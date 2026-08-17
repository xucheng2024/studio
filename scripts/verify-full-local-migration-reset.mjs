import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { readLocalSupabaseStatus } from "./lib/local-supabase-uat.mjs";

const REQUIRED_TABLES = ["business_idempotency_keys", "marketing_campaigns", "provider_events", "strong_audit_logs"];

function usage(exitCode = 0) {
  console.log("Usage: node scripts/verify-full-local-migration-reset.mjs [--apply | --dry-run]");
  console.log("  --dry-run  Verify the current local migration state without changing data (default).");
  console.log("  --apply    Reset the local Supabase database, then verify the migration state.");
  process.exit(exitCode);
}

function latestLocalMigration() {
  const migrations = readdirSync(join(process.cwd(), "supabase", "migrations"))
    .map((name) => name.match(/^(\d+)_.*\.sql$/)?.[1])
    .filter(Boolean)
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  const latest = migrations.at(-1);
  if (!latest) throw new Error("No local Supabase migrations found");
  return latest;
}

function queryDatabase(databaseUrl, sql) {
  return execFileSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", databaseUrl, "-At", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

const [mode = "--dry-run"] = process.argv.slice(2);
if (["--help", "-h"].includes(mode) || process.argv.length > 3) usage(mode === "--help" || mode === "-h" ? 0 : 1);
if (!new Set(["--dry-run", "--apply"]).has(mode)) usage(1);

const status = readLocalSupabaseStatus();
if (mode === "--apply") {
  console.log("Resetting the local Supabase database...");
  execFileSync("npx", ["supabase", "db", "reset", "--local", "--no-seed"], { stdio: "inherit" });
}

const expectedMigration = latestLocalMigration();
const appliedMigration = queryDatabase(status.DB_URL, "select version from supabase_migrations.schema_migrations order by version desc limit 1;");
if (appliedMigration !== expectedMigration) {
  throw new Error(`Local migration mismatch: expected ${expectedMigration}, found ${appliedMigration || "none"}`);
}

const tables = queryDatabase(
  status.DB_URL,
  `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${REQUIRED_TABLES.map((name) => `'${name}'`).join(", ")}) order by table_name;`,
).split("\n").filter(Boolean);
const missingTables = REQUIRED_TABLES.filter((name) => !tables.includes(name));
if (missingTables.length) throw new Error(`Local schema is missing required tables: ${missingTables.join(", ")}`);

console.log(`Local migration state is valid through ${expectedMigration}.`);

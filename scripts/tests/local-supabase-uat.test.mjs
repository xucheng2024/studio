import assert from "node:assert/strict";
import test from "node:test";
import { validateLocalSupabaseStatus, waitForLocalDatabaseState } from "../lib/local-supabase-uat.mjs";

const validStatus = {
  API_URL: "http://127.0.0.1:54321",
  ANON_KEY: "anon",
  SERVICE_ROLE_KEY: "service",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
};

test("accepts complete loopback local Supabase status", () => {
  assert.equal(validateLocalSupabaseStatus(validStatus), validStatus);
  assert.equal(validateLocalSupabaseStatus({
    ...validStatus,
    API_URL: "http://[::1]:54321",
    DB_URL: "postgresql://postgres:postgres@[::1]:54322/postgres",
  }).API_URL, "http://[::1]:54321");
});

test("rejects incomplete or non-loopback status", () => {
  assert.throws(() => validateLocalSupabaseStatus({ ...validStatus, DB_URL: undefined }), /missing DB_URL/);
  assert.throws(() => validateLocalSupabaseStatus({ ...validStatus, API_URL: "https://example.com" }), /non-local Supabase API URL/);
});

test("waits for local database state without a fixed test sleep", async () => {
  let reads = 0;
  const value = await waitForLocalDatabaseState(
    async () => ({ status: ++reads === 2 ? "ready" : "pending" }),
    (row) => row.status === "ready",
    "test state",
    { timeoutMs: 100, intervalMs: 1 },
  );
  assert.deepEqual(value, { status: "ready" });
  assert.equal(reads, 2);
});

test("rejects invalid local database wait timing", async () => {
  await assert.rejects(
    waitForLocalDatabaseState(async () => null, () => false, "test state", { timeoutMs: 0 }),
    /positive integers/,
  );
});

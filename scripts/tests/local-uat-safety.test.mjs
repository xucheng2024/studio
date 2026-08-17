import assert from "node:assert/strict";
import test from "node:test";
import { APT_LOCAL_IDENTITY_LIST } from "../fixtures/apt-local-identities.mjs";
import { CRM02_LOCAL_IDENTITY_LIST } from "../fixtures/crm02-local-identities.mjs";
import { POS_LOCAL_IDENTITY_LIST } from "../fixtures/pos-local-identities.mjs";
import { assertLocalUatTargets } from "../lib/local-uat-safety.mjs";
import { ensureLocalAuthIdentities } from "../lib/local-fixture-auth.mjs";

test("local UAT rejects a remote app, API, or database target", () => {
  const local = { baseUrl: "http://127.0.0.1:3102", supabaseUrl: "http://localhost:54321", databaseUrl: "postgresql://postgres@127.0.0.1:54322/postgres" };
  assert.doesNotThrow(() => assertLocalUatTargets(local));
  for (const key of Object.keys(local)) assert.throws(() => assertLocalUatTargets({ ...local, [key]: "https://example.com" }), /non-local/);
});

test("CRM, POS, and APT fixtures have disjoint local Auth identities", () => {
  const crm = new Set(CRM02_LOCAL_IDENTITY_LIST.flatMap((identity) => [identity.id, identity.email]));
  const pos = new Set(POS_LOCAL_IDENTITY_LIST.flatMap((identity) => [identity.id, identity.email]));
  for (const identity of POS_LOCAL_IDENTITY_LIST) {
    assert.ok(!crm.has(identity.id));
    assert.ok(!crm.has(identity.email));
  }
  for (const identity of APT_LOCAL_IDENTITY_LIST) {
    assert.ok(!crm.has(identity.id));
    assert.ok(!crm.has(identity.email));
    assert.ok(!pos.has(identity.id));
    assert.ok(!pos.has(identity.email));
  }
});

test("generic local fixture provisioning refuses UUID and email collisions", async () => {
  const users = [];
  const admin = { auth: { admin: {
    listUsers: async () => ({ data: { users }, error: null }),
    createUser: async (user) => { users.push(user); return { data: { user }, error: null }; },
  } } };
  await ensureLocalAuthIdentities(admin, [CRM02_LOCAL_IDENTITY_LIST[0]], "CRM-02");
  await assert.rejects(
    ensureLocalAuthIdentities(admin, [{ ...CRM02_LOCAL_IDENTITY_LIST[0], email: "different@example.test" }], "CRM-02"),
    /UUID collision/,
  );
});

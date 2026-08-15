import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { COM01_LOCAL_IDENTITIES, COM01_LOCAL_IDENTITY_LIST } from "../fixtures/com01-local-identities.mjs";
import { ensureCom01LocalAuthIdentities } from "../lib/com01-local-auth.mjs";

function adminWith(users) {
  const state = [...users];
  return {
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: [...state] }, error: null };
        },
        async createUser(user) {
          state.push(user);
          return { data: { user }, error: null };
        },
      },
    },
    state,
  };
}

test("provisions all fixed COM-01 identities and reuses exact matches", async () => {
  const fake = adminWith([]);
  await ensureCom01LocalAuthIdentities(fake);
  assert.equal(fake.state.length, 6);
  await ensureCom01LocalAuthIdentities(fake);
  assert.equal(fake.state.length, 6);
});

test("refuses an email mapped to a different UUID", async () => {
  const fake = adminWith([{ id: "00000000-0000-0000-0000-000000000001", email: COM01_LOCAL_IDENTITIES.owner.email }]);
  await assert.rejects(ensureCom01LocalAuthIdentities(fake), /email collision/);
});

test("refuses a fixed UUID mapped to a different email", async () => {
  const fake = adminWith([{ id: COM01_LOCAL_IDENTITIES.owner.id, email: "wrong@example.com" }]);
  await assert.rejects(ensureCom01LocalAuthIdentities(fake), /UUID collision/);
});

test("SQL fixture uses every fixed Auth UUID/email identity", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "scripts/sql/com01_uat_local_execute.sql"), "utf8");
  for (const identity of COM01_LOCAL_IDENTITY_LIST) {
    assert.match(identity.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok(sql.includes(identity.id), `SQL fixture is missing ${identity.id}`);
    assert.ok(sql.includes(identity.email), `SQL fixture is missing ${identity.email}`);
  }
});

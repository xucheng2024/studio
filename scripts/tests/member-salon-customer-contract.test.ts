import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("joining a studio creates the salon customer the Clients list reads", () => {
  const lib = read("src/lib/member-studio.ts");
  const start = lib.indexOf("export async function upsertMemberStudioMembership(");
  const end = lib.indexOf("export async function verifyMemberStudioAccess(");
  assert.ok(start >= 0 && end > start);
  const upsert = lib.slice(start, end);

  assert.equal(lib.includes('import { ensureSelfSalonCustomer } from "@/lib/salon-appointments-self";'), true);
  assert.equal(upsert.includes(".from(\"member_studio_memberships\")"), true);
  assert.equal(upsert.includes("await ensureSelfSalonCustomer({ studioId: params.studioId, userId: params.userId });"), true);
  // Join and payment flows must not fail because the customer row could not be created.
  assert.equal(upsert.includes("} catch (error) {"), true);

  const verify = lib.slice(end);
  assert.equal(verify.includes("await upsertMemberStudioMembership(admin, {"), true);
});

test("clients list still reads salon_customers", () => {
  const sensitive = read("src/lib/salon-customer-sensitive.ts");
  const start = sensitive.indexOf("export async function listSalonCustomersForDashboard(");
  assert.ok(start >= 0);
  assert.equal(sensitive.slice(start, start + 2000).includes('.from("salon_customers")'), true);
});

test("backfill creates missing member customers idempotently and links guests safely", () => {
  const sql = read("supabase/migrations/20260929100000_backfill_member_salon_customers.sql");

  assert.equal(sql.includes("from public.member_studio_memberships m"), true);
  assert.equal(sql.includes("perform public.link_guest_salon_customers_for_user(v_member.user_id, v_member.email);"), true);
  assert.equal(sql.includes("insert into public.salon_customers (studio_id, user_id, full_name, email, phone, status, source)"), true);
  assert.equal(sql.includes("case when m.status = 'active' then 'active' else 'inactive' end"), true);
  assert.equal(sql.includes("on conflict (studio_id, user_id) where user_id is not null do nothing;"), true);
  assert.equal((sql.match(/where c\.studio_id = m\.studio_id and c\.user_id = m\.user_id/g) ?? []).length, 2);
  assert.ok(
    sql.indexOf("link_guest_salon_customers_for_user") < sql.indexOf("insert into public.salon_customers"),
    "guests must be linked before new rows are inserted",
  );
});

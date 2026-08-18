import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("server actions re-authenticate with current session user", () => {
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");
  const myAppointmentsPage = read("src/app/me/_shared/appointments-page.tsx");

  assert.equal(bookingPage.includes("const actionSupabase = await createClient();"), true);
  assert.equal(bookingPage.includes("actionSupabase.auth.getUser()"), true);
  assert.equal(bookingPage.includes("userId: actionUser.id"), true);

  assert.equal(myAppointmentsPage.includes("const actionSupabase = await createClient();"), true);
  assert.equal(myAppointmentsPage.includes("actionSupabase.auth.getUser()"), true);
  assert.equal(myAppointmentsPage.includes("userId: actionUser.id"), true);
});

test("idempotency failure path releases claim and reschedule key includes new time", () => {
  const service = read("src/lib/salon-appointments-self.ts");
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");
  const myAppointmentsPage = read("src/app/me/_shared/appointments-page.tsx");

  assert.equal(service.includes("if (!result.ok) {"), true);
  assert.equal(service.includes("await failIdempotencyKey({"), true);
  assert.equal(service.includes("retryable: true"), true);

  assert.equal(myAppointmentsPage.includes("apt04-reschedule:${appointmentId}:${parsed.toISOString()}"), true);
  assert.equal(bookingPage.includes("apt04-self-create:${crypto.randomUUID()}"), true);
  assert.equal(bookingPage.includes("apt04-self-create:${selfCustomer.salonCustomerId}"), false);
});

test("slot generation includes prep and buffer in location boundary checks", () => {
  const service = read("src/lib/salon-appointments-self.ts");

  assert.equal(service.includes("const earliestStartSecond = interval.startSecond + timing.prepMinutes * 60;"), true);
  assert.equal(
    service.includes("const latestStartSecond = interval.endSecond - (timing.durationMinutes + timing.bufferMinutes) * 60;"),
    true,
  );
  assert.equal(service.includes("const occupiedStartSecond = slotStartSecond - timing.prepMinutes * 60;"), true);
  assert.equal(
    service.includes("const occupiedEndSecond = slotStartSecond + (timing.durationMinutes + timing.bufferMinutes) * 60;"),
    true,
  );
});

test("/me appointments supports feedback and cross-studio visibility", () => {
  const shared = read("src/app/me/_shared/appointments-page.tsx");
  const mePage = read("src/app/(app)/me/appointments/page.tsx");
  const studioMePage = read("src/app/[studioSlug]/me/appointments/page.tsx");
  const memberTabs = read("src/components/StudioMemberTabs.tsx");

  assert.equal(shared.includes("getActiveMemberStudioSlugFromCookie"), true);
  assert.equal(shared.includes("if (activeCustomer?.id)"), true);
  assert.equal(shared.includes("No salon appointments found under your account."), true);
  assert.equal(shared.includes("Manage in studio page"), true);
  assert.equal(shared.includes("getFeedbackMessage"), true);

  assert.equal(mePage.includes("searchParams"), true);
  assert.equal(mePage.includes("renderAppointmentsPage(undefined, {"), true);
  assert.equal(studioMePage.includes("renderAppointmentsPage({ studioSlug }, {"), true);
  assert.equal(memberTabs.includes("-mx-4"), false);
  assert.equal(memberTabs.includes("overflow-x-auto"), true);
});

test("self booking page renders terms content and acceptance evidence fields", () => {
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");

  assert.equal(bookingPage.includes("summarizeTermsSnapshot"), true);
  assert.equal(bookingPage.includes("termsVersion?.content_snapshot"), true);
  assert.equal(bookingPage.includes("Terms & Conditions"), true);
  assert.equal(bookingPage.includes("name=\"terms_accepted\""), true);
  assert.equal(bookingPage.includes("name=\"terms_version_id\""), true);
  assert.equal(bookingPage.includes("name=\"privacy_accepted\""), true);
  assert.equal(bookingPage.includes("name=\"privacy_notice_version_id\""), true);
  assert.equal(bookingPage.includes("const latestTermsVersion = await getLatestSalonTermsVersion({ studioId });"), true);
  assert.equal(bookingPage.includes("latestTermsVersion.id !== termsVersionId"), true);
  assert.equal(bookingPage.includes("error=terms_version_stale"), true);
});

test("self-booking uses the production studio_services title contract", () => {
  const service = read("src/lib/salon-appointments-self.ts");

  assert.equal(service.includes('.select("id, title, is_active, default_duration_minutes'), true);
  assert.equal(service.includes('.order("title")'), true);
  assert.equal(service.includes("name: service.title"), true);
  assert.equal(service.includes('.select("id, name, is_active, default_duration_minutes'), false);
  assert.equal(service.includes('.select("id, display_name, employment_status")'), true);
  assert.equal(service.includes('.select("id, display_name, is_active, employment_status")'), false);
});

test("phase2 self booking page exposes payment options and conservative package rule", () => {
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");

  assert.equal(bookingPage.includes('name="payment_option"'), true);
  assert.equal(bookingPage.includes("Use package credits"), true);
  assert.equal(bookingPage.includes("Online deposit (30%)"), true);
  assert.equal(bookingPage.includes("Online full payment"), true);
  assert.equal(bookingPage.includes("conservative_studio_location_expiry_balance"), false);
  assert.equal(bookingPage.includes("conservative"), true);
});

test("phase2 service flow computes settlement server-side and links payment facts", () => {
  const service = read("src/lib/salon-appointments-self.ts");

  assert.equal(service.includes("apt04_prepare_online_settlement"), true);
  assert.equal(service.includes("apt04_finalize_package_settlement"), true);
  assert.equal(service.includes("completeOnSuccess: true"), true);
  assert.equal(service.includes("completeIdempotencyKey"), true);
  assert.equal(service.includes("payment_request_create_failed"), true);
});

test("phase2 migration defines settlement state machine and package cancel return trigger", () => {
  const migration = read("supabase/migrations/20260814220000_apt04_phase2_self_booking_settlement.sql");
  const hotfix = read("supabase/migrations/20260814233000_apt04_phase2_p1_correctness_hotfix.sql");

  assert.equal(migration.includes("create table if not exists public.salon_appointment_settlements"), true);
  assert.equal(migration.includes("create or replace function public.apt04_mark_settlement_paid"), true);
  assert.equal(migration.includes("create or replace function public.apt04_mark_settlement_terminal"), true);
  assert.equal(migration.includes("create or replace function public.pkg01_apply_appointment_cancel_return"), true);
  assert.equal(migration.includes("apt04_on_appointment_cancel_return_package_trg"), true);
  assert.equal(migration.includes("invalid settlement status transition"), true);
  assert.equal(hotfix.includes("create or replace function public.apt04_prepare_online_settlement"), true);
  assert.equal(hotfix.includes("create or replace function public.apt04_finalize_package_settlement"), true);
  assert.equal(hotfix.includes("set status = case when status = 'pending' then 'confirmed' else status end"), true);
});

test("phase2 my appointments includes continue payment entry", () => {
  const page = read("src/app/me/_shared/appointments-page.tsx");

  assert.equal(page.includes("Continue payment"), true);
  assert.equal(page.includes("studioCheckoutPath"), true);
  assert.equal(page.includes("settlement.status === \"pending_payment\""), true);
});

test("payment cron also sweeps pending salon appointments", () => {
  const route = read("src/app/api/cron/expire-payments/route.ts");

  assert.equal(route.includes('admin.rpc("expire_pending_salon_appointments"'), true);
  assert.equal(route.includes("expiredAppointments"), true);
});

test("APT-04 local UAT seeds privacy notice and accepts it before booking", () => {
  const appointmentsUat = read("scripts/verify-apt04-uat-local.mjs");
  const settlementSql = read("scripts/sql/apt04_settlement_uat_local_execute.sql");
  const settlementBrowser = read("scripts/verify-apt04-settlement-browser-local.mjs");

  assert.equal(appointmentsUat.includes("salon_privacy_notice_versions"), true);
  assert.equal(appointmentsUat.includes('input[name="privacy_accepted"]'), true);
  assert.equal(settlementSql.includes("insert into public.salon_privacy_notice_versions"), true);
  assert.equal(settlementBrowser.includes('input[name="privacy_accepted"]'), true);
});

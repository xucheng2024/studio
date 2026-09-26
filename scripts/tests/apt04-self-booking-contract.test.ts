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

  assert.equal(bookingPage.includes("apt04-reschedule:${appointmentId}:${slot.startsAtIso}"), true);
  assert.equal(myAppointmentsPage.includes("apt04-reschedule:"), false);
  assert.equal(bookingPage.includes("apt04-self-create:${crypto.randomUUID()}"), true);
  assert.equal(bookingPage.includes("apt04-self-create:${selfCustomer.salonCustomerId}"), false);
});

test("slot generation includes prep and buffer in location boundary checks", () => {
  const service = read("src/lib/salon-appointments-self.ts");

  assert.equal(service.includes("const rawEarliestStartSecond = interval.startSecond + timing.prepMinutes * 60;"), true);
  assert.equal(service.includes("Math.ceil(rawEarliestStartSecond / stepSeconds) * stepSeconds"), true);
  assert.equal(service.includes("+ Math.max(params.minLeadMinutes ?? 0, 0) * 60_000"), true);
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
  assert.equal(bookingPage.includes('redirect(withError(backTo, "terms_version_stale"))'), true);
});

test("self-booking uses the production studio_services title contract", () => {
  const service = read("src/lib/salon-appointments-self.ts");

  assert.equal(service.includes('.select("id, title, price, currency, is_active, online_bookable, default_duration_minutes'), true);
  assert.equal(service.includes('.order("title")'), true);
  assert.equal(service.includes("name: service.title"), true);
  assert.equal(service.includes('.select("id, name, is_active, default_duration_minutes'), false);
  assert.equal(service.includes('.select("id, display_name, employment_status, takes_appointments, instructor_id")'), true);
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

test("pay-at-store self bookings are confirmed instead of left to expire", () => {
  const service = read("src/lib/salon-appointments-self.ts");
  const migration = read("supabase/migrations/20260926100000_apt04_confirm_pay_at_store.sql");

  assert.equal(service.includes('admin.rpc("apt04_confirm_free_settlement"'), true);
  assert.equal(migration.includes("create or replace function public.apt04_confirm_free_settlement"), true);
  assert.equal(migration.includes("expires_at = null"), true);
  assert.equal(migration.includes("'pay_at_store_confirmed'"), true);
  assert.equal(migration.includes("to service_role"), true);
});

test("online settlement options are validated server-side before booking", () => {
  const service = read("src/lib/salon-appointments-self.ts");
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");

  assert.equal(service.includes("full > 0 && deposit < full ? deposit : null"), true);
  assert.equal(service.includes("const settlementCheck = await assertSelfBookingAllowed({"), true);
  assert.equal(service.includes('code: "payment_option_unavailable"'), true);
  assert.equal(bookingPage.includes("getSelfOnlinePaymentOptions"), true);
  assert.equal(bookingPage.includes("payment_option_unavailable"), true);
});

test("self booking resolves staff server-side and redirects to the studio-scoped appointments page", () => {
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");

  assert.equal(bookingPage.includes("const slot = await resolveSlot({"), true);
  assert.equal(bookingPage.includes("employeeId: slot.employeeId"), true);
  assert.equal(bookingPage.includes('"Any available staff"'), true);
  assert.equal(bookingPage.includes("const myAppointmentsPath = `/${studioSlug}/me/appointments`;"), true);
  assert.equal(bookingPage.includes("redirect(`${myAppointmentsPath}?ok=booked`)"), true);
  assert.equal(bookingPage.includes("groupSlotsByStartTime"), true);
  assert.equal(bookingPage.includes("Book this slot"), false);
});

test("customers reschedule by picking an available slot", () => {
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");
  const myAppointmentsPage = read("src/app/me/_shared/appointments-page.tsx");

  assert.equal(myAppointmentsPage.includes("Change time"), true);
  assert.equal(myAppointmentsPage.includes("?reschedule=${encodeURIComponent(appointment.id)}"), true);
  assert.equal(myAppointmentsPage.includes('type="datetime-local"'), false);
  assert.equal(bookingPage.includes("newResourceIds: slot.resourceIds"), true);
  assert.equal(bookingPage.includes("ignoreAppointmentId: appointment.id"), true);
});

test("studio booking rules gate customer self-service", () => {
  const service = read("src/lib/salon-appointments-self.ts");
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");
  const myAppointmentsPage = read("src/app/me/_shared/appointments-page.tsx");
  const migration = read("supabase/migrations/20260926120000_booking_rules_and_online_toggle.sql");

  assert.equal(migration.includes("appointment_min_notice_minutes integer not null default 60"), true);
  assert.equal(migration.includes("appointment_max_advance_days integer not null default 60"), true);
  assert.equal(migration.includes("appointment_change_cutoff_hours integer not null default 0"), true);
  assert.equal(migration.includes("online_bookable boolean not null default true"), true);

  assert.equal(service.includes('.eq("online_bookable", true)'), true);
  assert.equal(service.includes('code: "not_online_bookable"'), true);
  assert.equal((service.match(/code: "outside_booking_window"/g) ?? []).length >= 2, true);
  assert.equal((service.match(/code: "change_cutoff_passed"/g) ?? []).length >= 2, true);
  assert.equal(service.includes("SELF_BOOKING_MIN_LEAD_MINUTES"), false);

  assert.equal(bookingPage.includes("minLeadMinutes: rules.minNoticeMinutes"), true);
  assert.equal(bookingPage.includes("lastSelfBookableDate(rules, today)"), true);
  assert.equal(bookingPage.includes("canCustomerChangeAppointment(rules, rescheduleAppointment.starts_at)"), true);
  assert.equal(myAppointmentsPage.includes("canCustomerChangeAppointment(bookingRules, appointment.starts_at)"), true);
  assert.equal(myAppointmentsPage.includes("Online changes close"), true);
  assert.equal(myAppointmentsPage.includes('defaultValue="customer_cancelled"'), false);
});

test("appointments cannot overlap a class the employee teaches", () => {
  const service = read("src/lib/salon-appointments-self.ts");
  const migration = read("supabase/migrations/20260926160000_block_appointments_during_classes.sql");
  const dbScript = read("scripts/verify-apt04-db.sh");
  const sqlVerify = read("scripts/sql/verify_apt04_self_booking.sql");

  assert.equal(service.includes('.from("class_sessions")'), true);
  assert.equal(service.includes('.eq("status", "scheduled")'), true);
  assert.equal(service.includes("classBusyByEmployee"), true);
  assert.equal(service.includes("...(classBusyByEmployee.get(employee.id) ?? [])"), true);

  assert.equal(migration.includes("create or replace function public.assert_employee_available_for_appointment("), true);
  assert.equal(migration.includes("join public.class_sessions cs on cs.class_id = c.id"), true);
  assert.equal(migration.includes("cs.status = 'scheduled'"), true);
  assert.equal(migration.includes("errcode = '23P01'"), true);
  assert.equal(migration.includes("to service_role"), true);

  assert.equal(dbScript.includes("20260926100000_apt04_confirm_pay_at_store.sql"), true);
  assert.equal(dbScript.includes("20260926160000_block_appointments_during_classes.sql"), true);
  assert.equal(sqlVerify.includes("expected appointment overlapping a scheduled class to fail"), true);
});

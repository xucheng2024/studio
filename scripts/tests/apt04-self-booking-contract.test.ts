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

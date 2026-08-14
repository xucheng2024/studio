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
  const myAppointmentsPage = read("src/app/me/_shared/appointments-page.tsx");

  assert.equal(service.includes("if (!result.ok) {"), true);
  assert.equal(service.includes("await failIdempotencyKey({"), true);
  assert.equal(service.includes("retryable: true"), true);

  assert.equal(myAppointmentsPage.includes("apt04-reschedule:${appointmentId}:${parsed.toISOString()}"), true);
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

  assert.equal(shared.includes("getActiveMemberStudioSlugFromCookie"), true);
  assert.equal(shared.includes("No salon appointments found under your account."), true);
  assert.equal(shared.includes("Manage in studio page"), true);
  assert.equal(shared.includes("getFeedbackMessage"), true);

  assert.equal(mePage.includes("searchParams"), true);
  assert.equal(mePage.includes("renderAppointmentsPage(undefined, {"), true);
  assert.equal(studioMePage.includes("renderAppointmentsPage({ studioSlug }, {"), true);
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

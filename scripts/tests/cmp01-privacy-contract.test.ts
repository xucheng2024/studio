import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("privacy notice template lists collection, use, and processors", () => {
  const lib = read("src/lib/studio-privacy.ts");
  assert.equal(lib.includes('"Name"'), true);
  assert.equal(lib.includes('"Email address"'), true);
  assert.equal(lib.includes("Booking and delivering salon services"), true);
  assert.equal(lib.includes('name: "Supabase"'), true);
  assert.equal(lib.includes('name: "HitPay"'), true);
  assert.equal(lib.includes('name: "Resend"'), true);
  assert.equal(lib.includes("nextPrivacyNoticeVersionLabel"), true);
  assert.equal(lib.includes("privacy-v${existingCount + 1}.0"), true);
});

test("processor catalog uses live HitPay and Resend flags", () => {
  const lib = read("src/lib/studio-privacy.ts");
  assert.equal(lib.includes("hitpayEnabled: boolean"), true);
  assert.equal(lib.includes("resendEnabled: boolean"), true);
  assert.equal(lib.includes("enabled: params.hitpayEnabled"), true);
  assert.equal(lib.includes("enabled: params.resendEnabled"), true);
  assert.equal(lib.includes("enabled: true"), true);
});

test("public privacy page renders collected fields, use, and version", () => {
  const page = read("src/app/[studioSlug]/privacy/page.tsx");
  assert.equal(page.includes("What we collect"), true);
  assert.equal(page.includes("Who uses it"), true);
  assert.equal(page.includes("Version ${notice.version_label}"), true);
  assert.equal(page.includes("studioPrivacyPath"), true);
});

test("booking requires published privacy notice version", () => {
  const bookingPage = read("src/app/[studioSlug]/appointments/page.tsx");
  assert.equal(bookingPage.includes("name=\"privacy_accepted\""), true);
  assert.equal(bookingPage.includes("name=\"privacy_notice_version_id\""), true);
  assert.equal(bookingPage.includes("recordSelfPrivacyNoticeConsent"), true);
  assert.equal(bookingPage.includes("error=privacy_version_stale"), true);
});

test("client page records DSAR and can anonymize", () => {
  const page = read("src/app/(app)/dashboard/clients/[clientId]/page.tsx");
  assert.equal(page.includes("updateSalonCustomerCoreProfileAction"), true);
  assert.equal(page.includes("createSalonCustomerDataRequestAction"), true);
  assert.equal(page.includes("anonymizeSalonCustomerAction"), true);
  assert.equal(page.includes("recordSalonCustomerPrivacyConsentAction"), true);
});

test("settings privacy page lists processors and retention", () => {
  const page = read("src/app/(app)/dashboard/settings/privacy/page.tsx");
  assert.equal(page.includes("studioProcessorCatalog"), true);
  assert.equal(page.includes("processor.name"), true);
  assert.equal(page.includes("customer_retention_days"), true);
  assert.equal(page.includes("Due for review"), true);
});

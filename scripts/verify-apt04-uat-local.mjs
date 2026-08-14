import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { chromium, firefox, webkit } from "playwright";

const RUN_ID = process.env.APT04_UAT_RUN_ID;
const BASE_URL = (process.env.APT04_UAT_BASE_URL || "http://127.0.0.1:3104").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const requestedEngines = new Set(
  (process.env.APT04_UAT_ENGINES || "chrome,firefox,webkit").split(",").map((value) => value.trim()).filter(Boolean),
);
if (!RUN_ID) throw new Error("APT04_UAT_RUN_ID is required");
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Missing local Supabase env");
for (const value of [BASE_URL, SUPABASE_URL]) {
  if (!value.includes("127.0.0.1") && !value.includes("localhost")) {
    throw new Error(`Refuse non-local UAT endpoint: ${value}`);
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const outDir = path.join(process.cwd(), "tmp", "apt04-uat", RUN_ID);
const screenshotDir = path.join(outDir, "screenshots");
fs.mkdirSync(screenshotDir, { recursive: true });

const ids = {
  studio1: "a4040000-0000-4000-8000-000000000001",
  studio2: "a4040000-0000-4000-8000-000000000002",
  location1: "a4040000-0000-4000-8000-000000000011",
  location2: "a4040000-0000-4000-8000-000000000012",
  service1: "a4040000-0000-4000-8000-000000000021",
  employee1: "a4040000-0000-4000-8000-000000000031",
  customerA: "a4040000-0000-4000-8000-000000000041",
  customerB1: "a4040000-0000-4000-8000-000000000042",
  customerB2: "a4040000-0000-4000-8000-000000000043",
  customerFirefox: "a4040000-0000-4000-8000-000000000044",
  customerWebkit: "a4040000-0000-4000-8000-000000000045",
  resource1: "a4040000-0000-4000-8000-000000000051",
};
const slugSuffix = RUN_ID.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-32);
const slugs = { s1: `apt04-uat-s1-${slugSuffix}`, s2: `apt04-uat-s2-${slugSuffix}` };

function localYmd(offsetDays) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}
const dates = { primary: localYmd(3), secondary: localYmd(4), tertiary: localYmd(5) };

async function upsert(table, rows, options) {
  const { error } = await admin.from(table).upsert(rows, options);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function ensureUser(email) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const existing = data.users.find((user) => user.email === email);
    if (existing) return existing;
    if (data.users.length < 100) break;
    page += 1;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: email.split("@")[0] },
  });
  if (error) throw error;
  return data.user;
}

const userEmails = {
  a: "apt04-uat-a@example.com",
  b: "apt04-uat-b@example.com",
  c: "apt04-uat-unbound@example.com",
  firefox: "apt04-uat-firefox@example.com",
  webkit: "apt04-uat-webkit@example.com",
};
const users = Object.fromEntries(
  await Promise.all(Object.entries(userEmails).map(async ([key, email]) => [key, await ensureUser(email)])),
);

await upsert("users", Object.values(users).map((user) => ({ id: user.id, email: user.email })), { onConflict: "id" });
await upsert("user_profiles", Object.values(users).map((user) => ({
  id: user.id,
  email: user.email,
  full_name: `APT04 ${user.email.split("@")[0]}`,
  role: "member",
})), { onConflict: "id" });
await upsert("studios", [
  { id: ids.studio1, name: "APT04 UAT Studio S1", public_slug: slugs.s1, owner_id: users.a.id, contract_status: "active" },
  { id: ids.studio2, name: "APT04 UAT Studio S2", public_slug: slugs.s2, owner_id: users.b.id, contract_status: "active" },
], { onConflict: "id" });
await upsert("locations", [
  { id: ids.location1, studio_id: ids.studio1, name: "APT04 S1 Main", is_active: true },
  { id: ids.location2, studio_id: ids.studio2, name: "APT04 S2 Main", is_active: true },
], { onConflict: "id" });
await upsert("studio_services", [{
  id: ids.service1,
  studio_id: ids.studio1,
  title: "APT04 UAT Signature Service",
  price: 120,
  currency: "SGD",
  is_active: true,
  sort_order: 1,
  default_duration_minutes: 60,
  default_prep_minutes: 15,
  default_buffer_minutes: 15,
}], { onConflict: "id" });
await upsert("service_locations", [{
  studio_id: ids.studio1,
  service_id: ids.service1,
  location_id: ids.location1,
  is_enabled: true,
  uses_default_values: true,
  duration_override_minutes: null,
  buffer_override_minutes: null,
}], { onConflict: "service_id,location_id" });
await upsert("employees", [{
  id: ids.employee1,
  studio_id: ids.studio1,
  display_name: "APT04 UAT Therapist",
  employment_status: "active",
}], { onConflict: "id" });
await upsert("employee_locations", [{
  employee_id: ids.employee1,
  location_id: ids.location1,
  studio_id: ids.studio1,
  is_primary: true,
  is_active: true,
}], { onConflict: "employee_id,location_id" });
await upsert("service_employees", [{
  studio_id: ids.studio1,
  service_id: ids.service1,
  employee_id: ids.employee1,
  is_active: true,
}], { onConflict: "service_id,employee_id" });

const hours = [];
const employeeHours = [];
for (let weekday = 0; weekday <= 6; weekday += 1) {
  hours.push({ studio_id: ids.studio1, location_id: ids.location1, weekday, opens_at: "09:00", closes_at: "18:00", is_closed: false });
  employeeHours.push({ studio_id: ids.studio1, employee_id: ids.employee1, location_id: ids.location1, weekday, starts_at: "08:30", ends_at: "18:30", is_active: true });
}
{
  const { error: deleteLocationHoursError } = await admin
    .from("location_operating_hours")
    .delete()
    .eq("location_id", ids.location1);
  if (deleteLocationHoursError) throw deleteLocationHoursError;
  const { error: locationHoursError } = await admin.from("location_operating_hours").insert(hours);
  if (locationHoursError) throw locationHoursError;

  const { error: deleteEmployeeHoursError } = await admin
    .from("employee_working_hours")
    .delete()
    .eq("employee_id", ids.employee1)
    .eq("location_id", ids.location1);
  if (deleteEmployeeHoursError) throw deleteEmployeeHoursError;
  const { error: employeeHoursError } = await admin.from("employee_working_hours").insert(employeeHours);
  if (employeeHoursError) throw employeeHoursError;
}
await upsert("salon_resources", [{
  id: ids.resource1,
  studio_id: ids.studio1,
  location_id: ids.location1,
  name: "APT04 UAT Room",
  resource_type: "room",
  capacity: 1,
  is_active: true,
}], { onConflict: "id" });
await upsert("service_resource_requirements", [{
  studio_id: ids.studio1,
  service_id: ids.service1,
  resource_type: "room",
  required_quantity: 1,
}], { onConflict: "service_id,resource_type" });
await upsert("salon_customers", [
  { id: ids.customerA, studio_id: ids.studio1, user_id: users.a.id, full_name: "APT04 Customer A", email: users.a.email, status: "active", source: "online", preferred_location_id: ids.location1 },
  { id: ids.customerB1, studio_id: ids.studio1, user_id: users.b.id, full_name: "APT04 Customer B S1", email: users.b.email, status: "active", source: "online", preferred_location_id: ids.location1 },
  { id: ids.customerB2, studio_id: ids.studio2, user_id: users.b.id, full_name: "APT04 Customer B S2", email: users.b.email, status: "active", source: "online", preferred_location_id: ids.location2 },
  { id: ids.customerFirefox, studio_id: ids.studio1, user_id: users.firefox.id, full_name: "APT04 Firefox Customer", email: users.firefox.email, status: "active", source: "online", preferred_location_id: ids.location1 },
  { id: ids.customerWebkit, studio_id: ids.studio1, user_id: users.webkit.id, full_name: "APT04 WebKit Customer", email: users.webkit.email, status: "active", source: "online", preferred_location_id: ids.location1 },
], { onConflict: "id" });

const termsV1Id = crypto.randomUUID();
await upsert("salon_terms_versions", [{
  id: termsV1Id,
  studio_id: ids.studio1,
  version_label: `${RUN_ID}-v1`,
  content_hash: `${RUN_ID}-terms-v1`,
  content_snapshot: { title: "APT04 UAT Terms", body: "UAT-only terms content. No production data." },
  is_active: true,
  published_at: new Date().toISOString(),
}], { onConflict: "id" });

async function authCookies(email) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) throw verifyError;
  if (!verified.session) throw new Error(`No local session for ${email}`);
  let encodedCookies = [];
  const server = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: () => [], setAll: (values) => { encodedCookies = values; } },
  });
  const { error: sessionError } = await server.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (sessionError) throw sessionError;
  return encodedCookies.map(({ name, value }) => ({ name, value, url: BASE_URL }));
}

const evidence = [];
async function capture(page, browserName, file, expectedTexts = []) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const text = await page.locator("body").innerText();
  for (const expected of expectedTexts) assert.ok(text.includes(expected), `${browserName}/${file}: missing ${expected}`);
  const filename = `${browserName}-${file}`;
  await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
  evidence.push({ browser: browserName, file: filename, url: page.url(), expectedTexts });
  return text;
}

async function followStreamingRedirect(page) {
  await page.waitForTimeout(1_500);
  const refresh = await page.locator('meta[http-equiv="refresh"]').getAttribute("content").catch(() => null);
  if (refresh?.includes("url=")) {
    const target = refresh.slice(refresh.indexOf("url=") + 4);
    await page.goto(new URL(target, BASE_URL).toString(), { waitUntil: "domcontentloaded" });
  }
}

async function newAuthenticatedPage(browser, email, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  await context.addCookies(await authCookies(email));
  return { context, page: await context.newPage() };
}

function bookingUrl(date = dates.primary) {
  const query = new URLSearchParams({ location_id: ids.location1, service_id: ids.service1, date });
  return `${BASE_URL}/${slugs.s1}/appointments?${query}`;
}

async function bookFirstAvailable(page) {
  const forms = page.locator('form:has(input[name="slot_starts_at"])');
  await forms.first().waitFor({ state: "visible", timeout: 30_000 });
  const form = forms.first();
  const startsAt = await form.locator('input[name="slot_starts_at"]').inputValue();
  await form.locator('input[name="terms_accepted"]').check();
  await form.getByRole("button", { name: "Book this slot" }).click();
  await page.waitForLoadState("domcontentloaded");
  return startsAt;
}

const browserResults = [];
async function runBrowser(name, launcher, email, full = false) {
  const browser = await launcher();
  const result = { name, version: browser.version(), full, status: "running" };
  try {
    if (full) {
      const anonymous = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const anonymousPath = `/${slugs.s1}/appointments`;
      const authPath = `/${slugs.s1}/auth?next=${encodeURIComponent(anonymousPath)}`;
      const redirectResponse = await anonymous.request.get(`${BASE_URL}${anonymousPath}`);
      const redirectBody = await redirectResponse.text();
      assert.ok(redirectBody.includes(authPath) || redirectBody.includes(authPath.replaceAll("&", "&amp;")), "Missing auth redirect target");
      await anonymous.goto(`${BASE_URL}${authPath}`, { waitUntil: "domcontentloaded" });
      assert.match(anonymous.url(), new RegExp(`/${slugs.s1}/auth`));
      await capture(anonymous, name, "01-login-redirect.png");
      await anonymous.close();
    }

    const session = await newAuthenticatedPage(browser, email);
    await session.page.goto(bookingUrl(full ? dates.primary : dates.tertiary), { waitUntil: "domcontentloaded", timeout: 120_000 });
    assert.ok(
      await session.page.locator("option", { hasText: "APT04 UAT Signature Service" }).count() > 0,
      `${name}: service option missing`,
    );
    assert.ok((await session.page.locator("pre").first().innerText()).trim().length > 0, `${name}: terms snapshot missing`);
    await capture(session.page, name, "02-slots-and-terms.png", [
      "Book appointment",
      "Terms & Conditions",
      "Available slots",
    ]);

    if (full) {
      const mobile = await newAuthenticatedPage(browser, email, { width: 390, height: 844 });
      await mobile.page.goto(bookingUrl(dates.primary), { waitUntil: "domcontentloaded", timeout: 120_000 });
      await capture(mobile.page, name, "11-booking-390.png", ["Book appointment", "Available slots"]);
      assert.equal(await mobile.page.locator("body").evaluate((body) => body.scrollWidth <= 390), true, "390px booking overflows");
      await mobile.context.close();

      const staleForm = session.page.locator('form:has(input[name="slot_starts_at"])').first();
      await staleForm.locator('input[name="terms_accepted"]').check();
      const termsV2Id = crypto.randomUUID();
      const { error: termsError } = await admin.from("salon_terms_versions").insert({
        id: termsV2Id,
        studio_id: ids.studio1,
        version_label: `${RUN_ID}-v2`,
        content_hash: `${RUN_ID}-terms-v2`,
        content_snapshot: { title: "APT04 UAT Terms v2", body: "Updated during stale-version browser test." },
        is_active: true,
        published_at: new Date(Date.now() + 2_000).toISOString(),
      });
      if (termsError) throw termsError;
      await staleForm.getByRole("button", { name: "Book this slot" }).click();
      await capture(session.page, name, "10-terms-stale-rejected.png", ["Terms & Conditions have been updated"]);
      await session.page.goto(bookingUrl(dates.primary), { waitUntil: "domcontentloaded" });
    }

    const bookedAt = await bookFirstAvailable(session.page);
    await capture(session.page, name, "04-booking-success.png", ["Appointment submitted successfully", "APT04 UAT Signature Service"]);

    if (full) {
      const rescheduleForm = session.page.locator('form:has(button:text("Reschedule"))').first();
      await rescheduleForm.locator('input[name="new_starts_at"]').fill(`${dates.secondary}T11:00`);
      await rescheduleForm.getByRole("button", { name: "Reschedule" }).click();
      await capture(session.page, name, "06-reschedule-success.png", ["Appointment rescheduled"]);
    }

    const cancelForm = session.page.locator('form:has(button:text("Cancel"))').first();
    await cancelForm.getByRole("button", { name: "Cancel" }).click();
    await capture(session.page, name, "07-cancel-success.png", ["Appointment cancelled"]);

    if (full) {
      await session.page.goto(`${BASE_URL}/${slugs.s2}/appointments`, { waitUntil: "domcontentloaded" });
      await capture(session.page, name, "08-cross-studio-unlinked.png", ["not yet linked to a salon customer profile"]);
      await session.page.goto(`${BASE_URL}/me/appointments`, { waitUntil: "domcontentloaded" });
      await followStreamingRedirect(session.page);
      const aggregateText = await capture(session.page, name, "05-me-appointments.png", ["My appointments"]);
      assert.ok(
        aggregateText.includes("Showing your appointments across all studios") || session.page.url().includes(`/${slugs.s1}/me/appointments`),
        "Global appointment page neither aggregated nor redirected to active studio",
      );
      const mobileMe = await newAuthenticatedPage(browser, email, { width: 390, height: 844 });
      await mobileMe.page.goto(`${BASE_URL}/${slugs.s1}/me/appointments`, { waitUntil: "domcontentloaded" });
      await capture(mobileMe.page, name, "12-me-appointments-390.png", ["My appointments"]);
      assert.equal(await mobileMe.page.locator("body").evaluate((body) => body.scrollWidth <= 390), true, "390px appointments overflow");
      await mobileMe.context.close();
    }

    await session.context.close();
    result.status = "passed";
    result.bookedAt = bookedAt;
  } finally {
    await browser.close();
  }
  browserResults.push(result);
}

if (requestedEngines.has("chrome")) {
  await runBrowser("chrome", () => chromium.launch({ channel: "chrome", headless: true }), userEmails.a, true);
}
if (requestedEngines.has("firefox")) {
  await runBrowser("firefox", () => firefox.launch({ headless: true }), userEmails.firefox);
}
if (requestedEngines.has("webkit")) {
  await runBrowser("webkit", () => webkit.launch({ headless: true }), userEmails.webkit);
}

const { data: appointmentRows, error: appointmentError } = await admin
  .from("salon_appointments")
  .select("id,studio_id,salon_customer_id,status,starts_at")
  .eq("studio_id", ids.studio1)
  .in("salon_customer_id", [ids.customerA, ids.customerFirefox, ids.customerWebkit]);
if (appointmentError) throw appointmentError;
assert.ok((appointmentRows ?? []).length >= requestedEngines.size, "Expected browser-created appointments");

const index = {
  runId: RUN_ID,
  generatedAt: new Date().toISOString(),
  environment: { app: BASE_URL, supabase: SUPABASE_URL, classification: "local-isolated-uat" },
  fixture: { slugs, dates, studioIds: [ids.studio1, ids.studio2] },
  browsers: browserResults,
  assertions: {
    noProductionWrites: true,
    loginRedirect: true,
    termsRendered: true,
    staleTermsRejected: true,
    createRescheduleCancel: true,
    crossStudioUnlinked: true,
    mobile390NoHorizontalOverflow: true,
    databaseAppointmentCount: appointmentRows.length,
  },
  evidence,
};
fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, runId: RUN_ID, outDir, screenshots: evidence.length, browsers: browserResults }, null, 2));

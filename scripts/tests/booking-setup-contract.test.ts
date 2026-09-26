import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("recommended booking setup reuses guarded helpers", () => {
  const lib = read("src/lib/booking-setup.ts");

  assert.equal(lib.includes("await setLocationOperatingHoursForWeek({"), true);
  assert.equal(lib.includes("await setEmployeeWorkingLocations({"), true);
  assert.equal(lib.includes("await setEmployeeWorkingHoursForWeek({"), true);
  assert.equal(lib.includes("await setServicePublishScope({"), true);
  assert.equal(lib.includes("await setServiceEmployeeEligibilities({"), true);
  assert.equal(lib.includes("await publishPrivacyNotice({"), true);
  assert.equal(lib.includes('.from("employee_working_hours").insert'), false);
  assert.equal(lib.includes('.from("service_employees").insert'), false);
});

test("recommended booking setup only fills gaps", () => {
  const lib = read("src/lib/booking-setup.ts");

  assert.equal(lib.includes('export const DEFAULT_OPENS_AT = "10:00";'), true);
  assert.equal(lib.includes('export const DEFAULT_CLOSES_AT = "20:00";'), true);
  assert.equal(lib.includes("(location) => !snapshot.locationHours.get(location.id)?.length"), true);
  assert.equal(lib.includes("if (snapshot.employeeLocations.get(employee.id)?.size) continue;"), true);
  assert.equal(lib.includes("if (snapshot.employeeHourKeys.has(`${employee.id}:${locationId}`)) continue;"), true);
  assert.equal(lib.includes("if (snapshot.serviceLocations.get(service.id)?.size) continue;"), true);
  assert.equal(lib.includes("if (snapshot.serviceEmployees.get(service.id)?.size) continue;"), true);
  assert.equal(lib.includes("if (!snapshot.hasTerms) {"), true);
  assert.equal(lib.includes("if (!snapshot.hasPrivacy) {"), true);
});

test("setup and terms publishing require owner or all-location manager", () => {
  const lib = read("src/lib/booking-setup.ts");
  const actions = read("src/app/(app)/dashboard/_actions/booking-setup.ts");
  const page = read("src/app/(app)/dashboard/settings/booking/page.tsx");

  assert.equal((lib.match(/requireGlobalStaffScope\(\{/g) ?? []).length >= 2, true);
  assert.equal(lib.includes('roles: ["owner", "manager"]'), true);
  assert.equal(actions.includes('"use server";'), true);
  assert.equal(actions.includes("const { user } = await requireUser();"), true);
  assert.equal(page.includes('["owner", "manager"]'), true);
});

test("booking settings consolidate hours, staff, services, resources and rules", () => {
  const dir = "src/app/(app)/dashboard/settings/booking";
  const page = read(`${dir}/page.tsx`);
  const context = read(`${dir}/_sections/context.ts`);
  const overview = read(`${dir}/_sections/OverviewSection.tsx`);
  const hours = read(`${dir}/_sections/HoursSection.tsx`);
  const staff = read(`${dir}/_sections/StaffSection.tsx`);
  const services = read(`${dir}/_sections/ServicesSection.tsx`);
  const resources = read(`${dir}/_sections/ResourcesSection.tsx`);
  const rules = read(`${dir}/_sections/RulesSection.tsx`);
  const settings = read("src/app/(app)/dashboard/settings/page.tsx");

  for (const key of ["overview", "hours", "staff", "services", "resources", "rules"]) {
    assert.equal(context.includes(`key: "${key}"`), true, key);
  }
  assert.equal(page.includes('["owner", "manager"]'), true);
  assert.equal(overview.includes("Use recommended setup"), true);
  assert.equal(hours.includes("setLocationOperatingHoursWeekAction"), true);
  assert.equal(staff.includes("StaffWorkingHoursSetup"), true);
  assert.equal(staff.includes("createAvailabilityExceptionAction"), true);
  assert.equal(services.includes("setServiceEligibleEmployeesAction"), true);
  assert.equal(services.includes("setServiceOnlineBookableAction"), true);
  assert.equal(services.includes("updateServiceAvailabilityDefaultsAction"), true);
  assert.equal(resources.includes("upsertSalonResourceAction"), true);
  assert.equal(rules.includes("updateBookingRulesAction"), true);
  assert.equal(rules.includes('name="terms_body"'), true);

  assert.equal(settings.includes('title="Online booking"'), true);
  assert.equal(settings.includes('title="Staff availability"'), false);
  assert.equal(settings.includes('title="Resources"'), false);
});

test("scattered booking settings are removed or redirected", () => {
  const staffPage = read("src/app/(app)/dashboard/settings/staff-availability/page.tsx");
  const resourcesPage = read("src/app/(app)/dashboard/settings/resources/page.tsx");
  const locationsPage = read("src/app/(app)/dashboard/settings/locations/page.tsx");
  const servicesPage = read("src/app/(app)/dashboard/services/page.tsx");
  const privacyPage = read("src/app/(app)/dashboard/settings/privacy/page.tsx");

  assert.equal(staffPage.includes('query.set("tab", "staff")'), true);
  assert.equal(resourcesPage.includes('query.set("tab", "resources")'), true);
  assert.equal(locationsPage.includes("setLocationOperatingHoursWeekAction"), false);
  assert.equal(locationsPage.includes("/dashboard/settings/booking?tab=hours"), true);
  for (const action of [
    "setServiceEligibleEmployeesAction",
    "setServicePublishScopeAction",
    "setServiceResourceRequirementsAction",
    "updateServiceAvailabilityDefaultsAction",
    "copyServiceBookingSetupAction",
  ]) {
    assert.equal(servicesPage.includes(action), false, action);
  }
  assert.equal(servicesPage.includes("/dashboard/settings/booking?tab=services"), true);
  assert.equal(privacyPage.includes("publishStudioPrivacyNoticeAction"), false);
});

test("booking rules are validated and saved by owner or manager", () => {
  const lib = read("src/lib/booking-setup.ts");
  assert.equal(lib.includes("export async function updateBookingRules"), true);
  assert.equal(lib.includes("minNoticeMinutes > 10080"), true);
  assert.equal(lib.includes("maxAdvanceDays > 365"), true);
  assert.equal(lib.includes("changeCutoffHours > 168"), true);
  assert.equal(lib.includes("export async function setServiceOnlineBookable"), true);
});

test("everyone with studio access gets an employee record and opts in to appointments", () => {
  const migration = read("supabase/migrations/20260926140000_employees_auto_create_and_takes_appointments.sql");
  const postAuth = read("src/app/(app)/post-auth/page.tsx");
  const studioSettings = read("src/app/(app)/dashboard/_actions/studio-settings.ts");
  const bookingPage = read("src/app/(app)/dashboard/settings/booking/page.tsx");

  assert.equal(migration.includes("add column if not exists takes_appointments boolean not null default true"), true);
  assert.equal(migration.includes("create or replace function public.ensure_studio_employee("), true);
  assert.equal(migration.includes("create or replace function public.sync_studio_employees(p_studio_id uuid)"), true);
  assert.equal(migration.includes("bool_or(sm.role = 'instructor')"), true);
  assert.equal(migration.includes("perform public.ensure_studio_employee(s.id, s.owner_id, false)"), true);
  assert.equal(/create trigger/i.test(migration), false, "no trigger: fixtures seed employees explicitly");
  assert.equal(migration.includes("to service_role"), true);

  assert.equal(postAuth.includes('admin.rpc("sync_studio_employees", { p_studio_id: invite.studio_id })'), true);
  assert.equal(studioSettings.includes('admin.rpc("sync_studio_employees", { p_studio_id: createdStudio.id })'), true);
  assert.equal(bookingPage.includes('rpc("sync_studio_employees", { p_studio_id: studioId })'), true);
});

test("only staff who take appointments can be scheduled, assigned or booked", () => {
  const selfBooking = read("src/lib/salon-appointments-self.ts");
  const setup = read("src/lib/booking-setup.ts");
  const services = read("src/app/(app)/dashboard/settings/booking/_sections/ServicesSection.tsx");
  const staff = read("src/app/(app)/dashboard/settings/booking/_sections/StaffSection.tsx");
  const availability = read("src/lib/service-availability.ts");

  assert.equal(selfBooking.includes('.eq("takes_appointments", true)'), true);
  assert.equal(setup.includes('.eq("takes_appointments", true)'), true);
  assert.equal(setup.includes('key: "staff_bookable"'), true);
  assert.equal(setup.includes("export async function setEmployeeTakesAppointments"), true);
  assert.equal(services.includes('.eq("takes_appointments", true)'), true);
  assert.equal(services.includes('.eq("is_active", true)\n      .in("employment_status"'), false);
  assert.equal(staff.includes("setEmployeeTakesAppointmentsAction"), true);
  assert.equal(staff.includes("setEmployeeBookingLocationsAction"), true);
  assert.equal(staff.includes("employee.takes_appointments !== false"), true);
  assert.equal(availability.includes('.select("id, is_active, employment_status")'), false);
});

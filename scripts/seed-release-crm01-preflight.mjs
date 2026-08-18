/**
 * Idempotent CRM-01 release-preflight fixtures for one test studio.
 * Does not create payments, POS sales, or campaigns.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnvLocal();

const STUDIO_ID = process.env.RELEASE_CRM01_STUDIO_ID || "d8c5fce4-ec0e-46ad-b344-03c865f8c365";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const IDS = {
  manager: "a8c5fce4-ec0e-46ad-b344-03c865f80001",
  frontdesk: "a8c5fce4-ec0e-46ad-b344-03c865f80002",
  instructor: "a8c5fce4-ec0e-46ad-b344-03c865f80003",
  customer: "a8c5fce4-ec0e-46ad-b344-03c865f80004",
  instructorRow: "a8c5fce4-ec0e-46ad-b344-03c865f80011",
  employee: "a8c5fce4-ec0e-46ad-b344-03c865f80012",
  customerRow: "a8c5fce4-ec0e-46ad-b344-03c865f80021",
  classRow: "a8c5fce4-ec0e-46ad-b344-03c865f80031",
  session: "a8c5fce4-ec0e-46ad-b344-03c865f80032",
  booking: "a8c5fce4-ec0e-46ad-b344-03c865f80033",
};

const EMAILS = {
  manager: "release-preflight-manager@example.test",
  frontdesk: "release-preflight-frontdesk@example.test",
  instructor: "release-preflight-instructor@example.test",
  customer: "release-preflight-customer@example.test",
};

function assertOk(label, error) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function ensureAuthUser(id, email) {
  const { data: existing, error: getError } = await admin.auth.admin.getUserById(id);
  if (!getError && existing?.user) {
    if ((existing.user.email || "").toLowerCase() !== email) {
      throw new Error(`Auth UUID ${id} already used by a different email`);
    }
    return;
  }
  const { data: created, error } = await admin.auth.admin.createUser({
    id,
    email,
    email_confirm: true,
  });
  if (!error && created.user?.id === id) return;
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const recovered = listed?.users?.find((user) => user.id === id || (user.email || "").toLowerCase() === email);
  if (!recovered || recovered.id !== id || (recovered.email || "").toLowerCase() !== email) {
    throw error ?? new Error(`Could not provision Auth user ${email}`);
  }
}

async function main() {
  const { data: studio, error: studioError } = await admin.from("studios").select("id, name").eq("id", STUDIO_ID).maybeSingle();
  assertOk("studio", studioError);
  if (!studio) throw new Error(`Studio ${STUDIO_ID} not found`);

  const { data: locations, error: locationError } = await admin
    .from("locations")
    .select("id, name")
    .eq("studio_id", STUDIO_ID)
    .eq("is_active", true)
    .limit(1);
  assertOk("locations", locationError);
  const locationId = locations?.[0]?.id;
  if (!locationId) throw new Error("Test studio has no active location");

  await ensureAuthUser(IDS.manager, EMAILS.manager);
  await ensureAuthUser(IDS.frontdesk, EMAILS.frontdesk);
  await ensureAuthUser(IDS.instructor, EMAILS.instructor);
  await ensureAuthUser(IDS.customer, EMAILS.customer);

  const userRows = [
    { id: IDS.manager, email: EMAILS.manager },
    { id: IDS.frontdesk, email: EMAILS.frontdesk },
    { id: IDS.instructor, email: EMAILS.instructor },
    { id: IDS.customer, email: EMAILS.customer },
  ];
  const { error: usersError } = await admin.from("users").upsert(userRows, { onConflict: "id" });
  assertOk("users", usersError);
  const { error: profilesError } = await admin.from("user_profiles").upsert(
    userRows.map((row) => ({ id: row.id, email: row.email, full_name: `Release preflight ${row.email.split("@")[0]}`, role: "member" })),
    { onConflict: "id" },
  );
  assertOk("user_profiles", profilesError);

  const { error: instructorError } = await admin.from("instructors").upsert({
    id: IDS.instructorRow,
    name: "Release preflight instructor",
    studio_id: STUDIO_ID,
    location_id: locationId,
    email: EMAILS.instructor,
    is_active: true,
  }, { onConflict: "id" });
  assertOk("instructors", instructorError);

  const { error: employeeError } = await admin.from("employees").upsert({
    id: IDS.employee,
    studio_id: STUDIO_ID,
    user_id: IDS.instructor,
    instructor_id: IDS.instructorRow,
    display_name: "Release preflight instructor",
    email: EMAILS.instructor,
    employment_status: "active",
  }, { onConflict: "id" });
  assertOk("employees", employeeError);

  const { error: employeeLocationError } = await admin.from("employee_locations").upsert({
    employee_id: IDS.employee,
    location_id: locationId,
    studio_id: STUDIO_ID,
    is_primary: true,
    is_active: true,
  }, { onConflict: "employee_id,location_id" });
  assertOk("employee_locations", employeeLocationError);

  const memberships = [
    { user_id: IDS.manager, studio_id: STUDIO_ID, location_id: null, role: "manager", is_active: true },
    { user_id: IDS.frontdesk, studio_id: STUDIO_ID, location_id: locationId, role: "frontdesk", is_active: true },
    { user_id: IDS.instructor, studio_id: STUDIO_ID, location_id: locationId, role: "instructor", is_active: true },
  ];
  for (const membership of memberships) {
    let existingQuery = admin
      .from("staff_memberships")
      .select("id")
      .eq("user_id", membership.user_id)
      .eq("studio_id", membership.studio_id)
      .eq("role", membership.role);
    existingQuery = membership.location_id
      ? existingQuery.eq("location_id", membership.location_id)
      : existingQuery.is("location_id", null);
    const { data: existingMembership, error: membershipLookupError } = await existingQuery.maybeSingle();
    assertOk("staff_memberships lookup", membershipLookupError);
    if (existingMembership) continue;
    const { error: membershipInsertError } = await admin.from("staff_memberships").insert(membership);
    assertOk("staff_memberships", membershipInsertError);
  }

  const { error: customerError } = await admin.from("salon_customers").upsert({
    id: IDS.customerRow,
    studio_id: STUDIO_ID,
    user_id: IDS.customer,
    full_name: "Release preflight customer",
    email: EMAILS.customer,
    status: "active",
    source: "frontdesk",
    preferred_location_id: locationId,
  }, { onConflict: "id" });
  assertOk("salon_customers", customerError);

  const { error: prefError } = await admin.from("salon_customer_preferences").upsert({
    studio_id: STUDIO_ID,
    salon_customer_id: IDS.customerRow,
    preferred_services: "facial",
    created_by: IDS.manager,
    updated_by: IDS.manager,
  }, { onConflict: "studio_id,salon_customer_id" });
  assertOk("salon_customer_preferences", prefError);

  const { error: healthError } = await admin.from("salon_customer_health_profiles").upsert({
    studio_id: STUDIO_ID,
    salon_customer_id: IDS.customerRow,
    allergies: "none declared",
    patch_test_required: false,
    recorded_by: IDS.manager,
    updated_by: IDS.manager,
  }, { onConflict: "studio_id,salon_customer_id" });
  assertOk("salon_customer_health_profiles", healthError);

  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const { error: classError } = await admin.from("classes").upsert({
    id: IDS.classRow,
    studio_id: STUDIO_ID,
    title: "Release preflight class",
    instructor_id: IDS.instructorRow,
    capacity: 4,
    duration_min: 60,
    location_id: locationId,
    is_active: true,
  }, { onConflict: "id" });
  assertOk("classes", classError);

  const { error: sessionError } = await admin.from("class_sessions").upsert({
    id: IDS.session,
    class_id: IDS.classRow,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    spots_left: 3,
    location_id: locationId,
    capacity: 4,
    status: "scheduled",
    guest_price: 0,
    credits_required: 1,
    class_title_snapshot: "Release preflight class",
  }, { onConflict: "id" });
  assertOk("class_sessions", sessionError);

  const { error: bookingError } = await admin.from("bookings").upsert({
    id: IDS.booking,
    session_id: IDS.session,
    client_id: IDS.customer,
    location_id: locationId,
    status: "booked",
    payment_status: "paid",
  }, { onConflict: "id" });
  assertOk("bookings", bookingError);

  console.log(JSON.stringify({
    status: "seeded",
    studioId: STUDIO_ID,
    studioName: studio.name,
    locationId,
    roles: ["manager", "frontdesk", "instructor"],
    createdPayments: false,
  }));
}

main().catch((error) => {
  console.error("seed-release-crm01-preflight failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

/**
 * Read-only production preflight for the CRM-01 role/browser regression gate.
 * It intentionally reports only identifiers, roles and counts—never sensitive
 * customer profile contents or authentication material.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const studioId = process.env.CRM01_E2E_STUDIO_ID;
if (!supabaseUrl || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
if (!studioId) throw new Error("Missing CRM01_E2E_STUDIO_ID (use the isolated CRM-01 E2E studio UUID)");

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function main() {
  // This select both verifies the deployed employees schema and exercises the
  // exact active-employee predicate used by CRM-01.
  const { count: activeEmployeeCount, error: activeEmployeeError } = await admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", studioId)
    .eq("employment_status", "active");
  if (activeEmployeeError) throw new Error(`employees.employment_status active predicate: ${activeEmployeeError.message}`);

  const { data: memberships, error: membershipsError } = await admin
    .from("staff_memberships")
    .select("user_id, role, location_id")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .in("role", ["manager", "frontdesk", "instructor"]);
  if (membershipsError) throw membershipsError;

  const roleCounts = Object.fromEntries(
    ["manager", "frontdesk", "instructor"].map((role) => [role, (memberships ?? []).filter((row) => row.role === role).length]),
  );
  const [{ count: customerCount, error: customerError }, { count: healthCount, error: healthError }, { count: preferenceCount, error: preferenceError }] =
    await Promise.all([
      admin.from("salon_customers").select("id", { count: "exact", head: true }).eq("studio_id", studioId),
      admin.from("salon_customer_health_profiles").select("salon_customer_id", { count: "exact", head: true }).eq("studio_id", studioId),
      admin.from("salon_customer_preferences").select("salon_customer_id", { count: "exact", head: true }).eq("studio_id", studioId),
    ]);
  if (customerError || healthError || preferenceError) throw customerError ?? healthError ?? preferenceError;

  const { data: customerRows, error: customerRowsError } = await admin
    .from("salon_customers")
    .select("id, user_id")
    .eq("studio_id", studioId)
    .not("user_id", "is", null);
  if (customerRowsError) throw customerRowsError;
  const customerUserIds = (customerRows ?? []).map((row) => row.user_id).filter(Boolean);
  const { data: bookingRows, error: bookingError } = await admin
    .from("bookings")
    .select("client_id, class_sessions!inner(location_id, classes!inner(studio_id))")
    .in("client_id", customerUserIds)
    .eq("class_sessions.classes.studio_id", studioId);
  if (bookingError) throw bookingError;
  const failures = [
    ...(activeEmployeeCount ? [] : ["active employee fixture missing"]),
    ...Object.entries(roleCounts).flatMap(([role, count]) => (count ? [] : [`active ${role} membership missing`])),
    ...(!customerCount ? ["CRM-01 customer fixture missing"] : []),
    ...(!healthCount ? ["CRM-01 health profile fixture missing"] : []),
    ...(!preferenceCount ? ["CRM-01 preference fixture missing"] : []),
    ...(!(bookingRows ?? []).length ? ["booking relationship fixture missing"] : []),
  ];

  console.log(JSON.stringify({
        ok: failures.length === 0,
        studioId,
        activeEmployeeCount: activeEmployeeCount ?? 0,
        activeMembershipsByRole: roleCounts,
        customerCount,
        healthProfileCount: healthCount,
        preferenceProfileCount: preferenceCount,
        bookingRelationshipCount: bookingRows?.length ?? 0,
        note: "Read-only preflight passed; run browser/mobile tests with real Manager, Frontdesk, and Instructor sessions.",
        failures,
      }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error("verify-crm01-production-preflight failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

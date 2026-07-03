/**
 * Smoke-check Dr. Truman public page data (no HTTP server required).
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvLocal() {
  try {
    const p = path.resolve(process.cwd(), ".env.local");
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

loadDotEnvLocal();

const SLUG = "dr-truman";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function main() {
  const { data: studio, error } = await admin
    .from("studios")
    .select(
      "id, name, public_slug, public_brand_name, public_intro, public_services_title, public_member_zone_title, contract_status, calcom_booking_enabled, calcom_embed_url, whatsapp_enabled",
    )
    .eq("public_slug", SLUG)
    .maybeSingle();
  if (error) throw error;
  if (!studio?.id) throw new Error(`Studio /${SLUG} not found`);

  const { data: mzSeriesRows } = await admin.from("member_zone_series").select("id").eq("studio_id", studio.id);
  const mzSeriesIds = (mzSeriesRows ?? []).map((r) => r.id);
  const { count: memberZoneLessonCount } = mzSeriesIds.length
    ? await admin
        .from("member_zone_lessons")
        .select("id", { count: "exact", head: true })
        .in("series_id", mzSeriesIds)
    : { count: 0 };

  const [
    { count: serviceCount },
    { count: faqCount },
    { count: locationCount },
    { count: classCount },
    { count: shopCount },
    { count: memberZoneSeriesCount },
  ] = await Promise.all([
    admin.from("studio_services").select("id", { count: "exact", head: true }).eq("studio_id", studio.id).eq("is_active", true),
    admin.from("studio_faqs").select("id", { count: "exact", head: true }).eq("studio_id", studio.id),
    admin.from("locations").select("id", { count: "exact", head: true }).eq("studio_id", studio.id).eq("is_active", true),
    admin.from("classes").select("id", { count: "exact", head: true }).eq("studio_id", studio.id).eq("is_active", true),
    admin.from("shop_products").select("id", { count: "exact", head: true }).eq("studio_id", studio.id).eq("is_active", true),
    admin.from("member_zone_series").select("id", { count: "exact", head: true }).eq("studio_id", studio.id).eq("is_active", true),
  ]);

  const checks = [
    { name: "studio_active", ok: studio.contract_status !== "suspended" },
    { name: "brand_dr_truman", ok: studio.public_brand_name === "Dr. Truman" },
    { name: "treatments_section_title", ok: studio.public_services_title === "Treatments" },
    { name: "intro_present", ok: (studio.public_intro ?? "").length > 100 },
    { name: "four_services", ok: (serviceCount ?? 0) === 4 },
    { name: "eight_faqs", ok: (faqCount ?? 0) === 8 },
    { name: "location_exists", ok: (locationCount ?? 0) >= 1 },
    { name: "no_classes_section", ok: (classCount ?? 0) === 0 },
    { name: "no_shop_section", ok: (shopCount ?? 0) === 0 },
    { name: "expert_courses_section_title", ok: studio.public_member_zone_title === "Expert courses" },
    { name: "free_member_zone_series", ok: (memberZoneSeriesCount ?? 0) === 1 },
    { name: "four_member_zone_lessons", ok: (memberZoneLessonCount ?? 0) === 4 },
  ];

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed: failed.map((f) => f.name), studio, serviceCount, faqCount }, null, 2));
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        publicUrl: `/${SLUG}`,
        sectionsExpected: ["Intro", "Treatments", "Expert courses", "FAQs"],
        sectionsHidden: ["Classes", "Shop", "Events", "Packages"],
        bookingEnabled: studio.calcom_booking_enabled && Boolean(studio.calcom_embed_url),
        whatsappEnabled: studio.whatsapp_enabled,
        serviceCount,
        faqCount,
        locationCount,
        memberZoneSeriesCount: memberZoneSeriesCount ?? 0,
        memberZoneLessonCount: memberZoneLessonCount ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("verify-dr-truman-public failed:", err);
  process.exit(1);
});

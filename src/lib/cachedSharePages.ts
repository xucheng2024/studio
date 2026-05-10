import { cache } from "react";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizeShareSlug(raw: string) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Dedupes studio + class fetches when both `generateMetadata` and the page run in the same request.
 */
export const getCachedClassShareContext = cache(async (studioSlugRaw: string, classSlugRaw: string) => {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const classSlug = normalizeShareSlug(classSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(classSlug)) return null;

  const supabase = createAdminClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: cls } = await supabase
    .from("classes")
    .select("id, title, description, studio_id, capacity, is_active, image_url, video_url, locations ( name )")
    .eq("studio_id", studio.id)
    .eq("share_slug", classSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!cls) return null;

  return { studio, cls };
});

/**
 * Dedupes studio + package fetches for shared buy links (metadata + page).
 */
export const getCachedPackageShareContext = cache(async (studioSlugRaw: string, packageSlugRaw: string) => {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const pkgSlug = normalizeShareSlug(packageSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(pkgSlug)) return null;

  const supabase = createAdminClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: pkg } = await supabase
    .from("packages")
    .select("id, name, credits, price, expiry_days, location_id, is_active, share_slug, locations ( name )")
    .eq("studio_id", studio.id)
    .eq("share_slug", pkgSlug)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pkg) return null;

  return { studio, pkg };
});

export const getCachedMembershipShareContext = cache(async (studioSlugRaw: string, membershipSlugRaw: string) => {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const membershipSlug = normalizeShareSlug(membershipSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(membershipSlug)) return null;

  const supabase = createAdminClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: membership } = await supabase
    .from("membership_products")
    .select("id, name, description, price, currency, billing_interval, trial_days, share_slug, is_active")
    .eq("studio_id", studio.id)
    .eq("share_slug", membershipSlug)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (!membership) return null;

  return { studio, membership };
});

export const getCachedServiceShareContext = cache(async (studioSlugRaw: string, serviceSlugRaw: string) => {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const serviceSlug = normalizeShareSlug(serviceSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(serviceSlug)) return null;

  const supabase = createAdminClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: service } = await supabase
    .from("studio_services")
    .select("id, title, summary, description, price, currency, cover_image_url, video_url, tags, share_slug, is_active")
    .eq("studio_id", studio.id)
    .eq("share_slug", serviceSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!service) return null;

  return { studio, service };
});

export const getCachedEventShareContext = cache(async (studioSlugRaw: string, eventSlugRaw: string) => {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const eventSlug = normalizeShareSlug(eventSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(eventSlug)) return null;

  const supabase = createAdminClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: event } = await supabase
    .from("events")
    .select("id, title, description, tags, studio_id, start_time, end_time, capacity, spots_left, price, currency, image_url, video_url, share_slug, is_active, address, address_details")
    .eq("studio_id", studio.id)
    .eq("share_slug", eventSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!event) return null;

  return { studio, event };
});

export const getCachedMemberZoneShareContext = cache(async (studioSlugRaw: string, seriesSlugRaw: string) => {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const seriesSlug = normalizeShareSlug(seriesSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(seriesSlug)) return null;

  const supabase = createAdminClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: series } = await supabase
    .from("member_zone_series")
    .select("id, title, summary, description, cover_image_url, promo_video_url, access_type, price, currency, share_slug, is_active")
    .eq("studio_id", studio.id)
    .eq("share_slug", seriesSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!series) return null;

  return { studio, series };
});

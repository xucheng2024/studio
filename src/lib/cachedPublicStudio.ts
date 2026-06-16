import { cache } from "react";
import { unstable_cache } from "next/cache";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioPublicCacheTag } from "@/lib/revalidatePublic";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

const STUDIO_SHELL_SELECT =
  "id, name, public_slug, contract_status, public_brand_name, public_logo_url, public_intro, public_cover_image_url, public_video_url, public_services_title, public_classes_title, public_packages_title, public_events_title, public_member_zone_title, public_shop_title, public_instagram_url, public_linkedin_url, public_facebook_url, public_tiktok_url, public_youtube_url, public_x_url, public_contact_email, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text, hitpay_enabled, calcom_booking_enabled, calcom_embed_url";

const STUDIO_LAYOUT_META_SELECT =
  "name, public_brand_name, public_logo_url, contract_status, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text";

export type PublicStudioShell = NonNullable<Awaited<ReturnType<typeof fetchPublicStudioShell>>>;

async function fetchPublicStudioShell(slug: string) {
  const admin = createAdminClient();
  const { data: studio, error } = await admin
    .from("studios")
    .select(STUDIO_SHELL_SELECT)
    .eq("public_slug", slug)
    .maybeSingle();
  if (error) {
    console.error("[public-studio] fetch failed", { slug, message: error.message });
    return null;
  }
  if (!studio || studio.contract_status === "suspended") return null;
  return studio;
}

function getShellCached(slug: string) {
  return unstable_cache(async () => fetchPublicStudioShell(slug), ["public-studio-shell-v2", slug], {
    revalidate: 60,
    tags: [studioPublicCacheTag(slug)],
  })();
}

async function buildPublicStudioLandingData(slug: string) {
  const studio = await fetchPublicStudioShell(slug);
  if (!studio) return null;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const [
    { data: services },
    { data: classes },
    { data: packages },
    { data: memberships },
    { data: events },
    { data: pastEvents },
    { data: memberZoneSeries },
    { data: shopProducts },
    { data: faqs },
  ] = await Promise.all([
    admin
      .from("studio_services")
      .select("id, title, summary, description, price, cover_image_url, video_url, tags, share_slug, sort_order")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("class_sessions")
      .select("id, start_time, spots_left, capacity, guest_price, credits_required, class_title_snapshot, class_description_snapshot, class_image_url_snapshot, locations(name), classes!inner(title, description, share_slug, image_url, tags, studio_id, is_active, capacity)")
      .eq("classes.studio_id", studio.id)
      .eq("classes.is_active", true)
      .eq("status", "scheduled")
      .gte("start_time", nowIso)
      .order("start_time", { ascending: true })
      .limit(8),
    admin
      .from("packages")
      .select("id, name, price, credits, expiry_days, location_id, share_slug")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("price", { ascending: true }),
    admin
      .from("membership_products")
      .select("id, name, description, price, billing_interval, trial_days, share_slug")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    admin
      .from("events")
      .select("id, title, description, tags, start_time, end_time, capacity, spots_left, price, share_slug, image_url, video_url, is_active")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .gte("end_time", nowIso)
      .order("start_time", { ascending: true })
      .limit(12),
    admin
      .from("events")
      .select("id, title, description, tags, start_time, end_time, capacity, spots_left, price, share_slug, image_url, video_url, is_active")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .lt("end_time", nowIso)
      .order("start_time", { ascending: false })
      .limit(6),
    admin
      .from("member_zone_series")
      .select("id, title, summary, description, cover_image_url, promo_video_url, access_type, price, share_slug, sort_order")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("shop_products")
      .select("id, title, summary, image_url, price, share_slug, stock_qty, sort_order")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("studio_faqs")
      .select("id, question, answer, sort_order, created_at")
      .eq("studio_id", studio.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  return {
    studio,
    services: services ?? [],
    classes: classes ?? [],
    packages: packages ?? [],
    memberships: memberships ?? [],
    events: events ?? [],
    pastEvents: pastEvents ?? [],
    memberZoneSeries: memberZoneSeries ?? [],
    shopProducts: shopProducts ?? [],
    faqs: faqs ?? [],
  };
}

function getLandingDataCached(slug: string) {
  return unstable_cache(async () => buildPublicStudioLandingData(slug), ["public-studio-landing-v2", slug], {
    revalidate: 60,
    tags: [studioPublicCacheTag(slug)],
  })();
}

async function fetchStudioLayoutMeta(slug: string) {
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select(STUDIO_LAYOUT_META_SELECT)
    .eq("public_slug", slug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;
  return studio;
}

function getLayoutMetaCached(slug: string) {
  return unstable_cache(async () => fetchStudioLayoutMeta(slug), ["public-studio-layout-meta-v2", slug], {
    revalidate: 60,
    tags: [studioPublicCacheTag(slug)],
  })();
}

function resolveSlug(studioSlugRaw: string) {
  const slug = normalizeStudioSlug(studioSlugRaw ?? "");
  if (!slug || isReservedPublicSlug(slug)) return null;
  return slug;
}

/** Per-request dedupe; cross-request ISR via unstable_cache (60s). */
export const getPublicStudioShell = cache(async (studioSlugRaw: string) => {
  const slug = resolveSlug(studioSlugRaw);
  if (!slug) return null;
  return getShellCached(slug);
});

export const getPublicStudioData = cache(async (studioSlugRaw: string) => {
  const slug = resolveSlug(studioSlugRaw);
  if (!slug) return null;
  return getLandingDataCached(slug);
});

/** Layout metadata + WhatsApp FAB (shared cache tag with landing page). */
export const getCachedStudioPublicMeta = cache(async (studioSlugRaw: string) => {
  const slug = resolveSlug(studioSlugRaw);
  if (!slug) return null;
  return getLayoutMetaCached(slug);
});

export type PublicStudioLandingData = NonNullable<Awaited<ReturnType<typeof buildPublicStudioLandingData>>>;

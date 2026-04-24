import { cache } from "react";
import { normalizeStudioSlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: cls } = await supabase
    .from("classes")
    .select("id, title, description, studio_id, capacity, is_active, image_url, locations ( name )")
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

  const supabase = await createClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: pkg } = await supabase
    .from("packages")
    .select("id, name, credits, price, expiry_days, location_id, is_active, image_url, share_slug, locations ( name )")
    .eq("studio_id", studio.id)
    .eq("share_slug", pkgSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!pkg) return null;

  return { studio, pkg };
});

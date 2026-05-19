import { revalidatePath, revalidateTag } from "next/cache";
import { normalizeStudioSlug } from "@/lib/slug";

export const RBAC_CACHE_TAG = "rbac-access-context";

export function studioPublicCacheTag(publicSlug: string) {
  const slug = normalizeStudioSlug(publicSlug);
  return `studio-public-${slug || "unknown"}`;
}

export function revalidateStudioPublicCache(publicSlug: string | null | undefined) {
  const slug = normalizeStudioSlug(publicSlug ?? "");
  if (!slug) return;
  revalidateTag(studioPublicCacheTag(slug), "max");
}

/** Invalidate ISR path + Data Cache tag for a studio public landing page. */
export function revalidatePublicStudioPath(publicSlug: string | null | undefined) {
  const slug = normalizeStudioSlug(publicSlug ?? "");
  if (!slug) return;
  revalidatePath(`/${slug}`);
  revalidateStudioPublicCache(slug);
}

export function revalidateRbacCache() {
  revalidateTag(RBAC_CACHE_TAG, "max");
}

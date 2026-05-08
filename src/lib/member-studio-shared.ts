import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";

export const ACTIVE_MEMBER_STUDIO_COOKIE = "member_active_studio_slug";

export function parseStudioSlugFromPath(pathname: string): string | null {
  const path = pathname.trim();
  const patterns = [
    /^\/([a-z0-9-]{3,60})\/(?:classes|events|services|packages|memberships|member-zone|me|checkout|auth)(?:\/|$)/i,
    /^\/m\/([a-z0-9-]{3,60})\/auth(?:\/|$)/i,
    /^\/([a-z0-9-]{3,60})(?:\/|$)/i,
  ];
  for (const p of patterns) {
    const m = path.match(p);
    if (!m) continue;
    const slug = normalizeStudioSlug(m[1] ?? "");
    if (slug && !isReservedPublicSlug(slug)) return slug;
  }
  return null;
}

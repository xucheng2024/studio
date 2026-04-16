/** URL-safe studio slug: lowercase letters, digits, hyphen; 3–60 chars. */
export function normalizeStudioSlug(raw: string): string | null {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length < 3) return null;
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, "");
  return s || null;
}

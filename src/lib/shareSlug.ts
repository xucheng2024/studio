/** Public share segment: lowercase letters, digits, hyphen; 6–80 chars. */
const SHARE_SLUG_RE = /^[a-z0-9-]{6,80}$/;

export function isValidShareSlug(s: string | null | undefined): boolean {
  if (s == null || s === "") return false;
  return SHARE_SLUG_RE.test(s);
}

export function normalizeShareSlugInput(raw: string): string | null {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length < 6) return null;
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, "");
  return isValidShareSlug(s) ? s : null;
}

const RAND_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateShareSlugSegment(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += RAND_CHARS[Math.floor(Math.random() * RAND_CHARS.length)];
  }
  return out;
}

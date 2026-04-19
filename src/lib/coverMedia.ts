import { getSupabaseUrl } from "@/lib/supabase/env";

export const COVER_MEDIA_BUCKET = "public-media";
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Relative path served from this app when no cover is set. */
export const COVER_PLACEHOLDER_PATH = "/cover-placeholder.svg";

export function getAppOriginForOg(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (raw) return raw;
  const vercel = process.env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (vercel) return `https://${vercel}`;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "";
}

export function absolutePlaceholderCoverUrl(): string {
  const base = getAppOriginForOg();
  if (!base) return COVER_PLACEHOLDER_PATH;
  return `${base}${COVER_PLACEHOLDER_PATH}`;
}

/** True if URL is our Supabase public-media object URL (prevents arbitrary URL injection). */
export function isTrustedCoverImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const supabase = getSupabaseUrl()?.replace(/\/$/, "");
  if (!supabase) return false;
  const prefix = `${supabase}/storage/v1/object/public/${COVER_MEDIA_BUCKET}/`;
  return url.startsWith(prefix);
}

/** Extract storage object path (e.g. classes/uuid/cover-1.jpg) from a trusted public URL, or null. */
export function storagePathFromCoverUrl(url: string | null | undefined): string | null {
  if (!url || !isTrustedCoverImageUrl(url)) return null;
  const supabase = getSupabaseUrl()?.replace(/\/$/, "");
  if (!supabase) return null;
  const prefix = `${supabase}/storage/v1/object/public/${COVER_MEDIA_BUCKET}/`;
  return url.slice(prefix.length).split("?")[0] ?? null;
}

export function extensionForMime(mime: string): "jpg" | "png" | "webp" | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

import sharp from "sharp";
import { COVER_MEDIA_BUCKET, getAppOriginForOg, storagePathFromCoverUrl } from "@/lib/coverMedia";
import { getSupabaseUrl } from "@/lib/supabase/env";

export const PWA_ICON_VARIANTS = ["180", "192", "512", "maskable"] as const;
export type PwaIconVariant = (typeof PWA_ICON_VARIANTS)[number];

const MASKABLE_BG = { r: 247, g: 244, b: 239, alpha: 1 } as const;
const ICON_BG = { r: 255, g: 255, b: 255, alpha: 1 } as const;

export function parsePwaIconVariant(raw: string | null | undefined): PwaIconVariant | null {
  const value = (raw ?? "").trim().toLowerCase();
  return (PWA_ICON_VARIANTS as readonly string[]).includes(value) ? (value as PwaIconVariant) : null;
}

export function pwaIconStoragePathFromLogoPath(logoPath: string, variant: PwaIconVariant): string {
  const base = logoPath.replace(/\.[^.]+$/, "");
  return `${base}-pwa-${variant}.png`;
}

export function pwaIconPathsFromLogoPath(logoPath: string): string[] {
  return PWA_ICON_VARIANTS.map((variant) => pwaIconStoragePathFromLogoPath(logoPath, variant));
}

export function pwaIconPublicUrlFromLogoUrl(logoUrl: string, variant: PwaIconVariant): string | null {
  const logoPath = storagePathFromCoverUrl(logoUrl);
  if (!logoPath) return null;
  const supabase = getSupabaseUrl()?.replace(/\/$/, "");
  if (!supabase) return null;
  const pwaPath = pwaIconStoragePathFromLogoPath(logoPath, variant);
  return `${supabase}/storage/v1/object/public/${COVER_MEDIA_BUCKET}/${pwaPath}`;
}

export function studioPwaIconPath(studioSlug: string, variant: PwaIconVariant): string {
  return `/pwa/${studioSlug}/icons/${variant}`;
}

function normalizeHost(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

export function studioPwaIconAbsoluteUrl(
  studioSlug: string,
  variant: PwaIconVariant,
  customDomain?: string | null,
  customDomainStatus?: string | null,
): string {
  const path = studioPwaIconPath(studioSlug, variant);
  const customHost =
    customDomainStatus === "active" ? normalizeHost(customDomain) : "";
  const origin = customHost ? `https://${customHost}` : getAppOriginForOg();
  return origin ? `${origin}${path}` : path;
}

export function platformPwaFallbackFile(variant: PwaIconVariant): string {
  if (variant === "180") return "apple-touch-icon.png";
  if (variant === "192") return "icon-192.png";
  return "icon-512.png";
}

export async function renderPwaIconPng(input: Buffer, variant: PwaIconVariant): Promise<Buffer> {
  const size = variant === "maskable" ? 512 : Number(variant);

  if (variant === "maskable") {
    const inner = Math.round(size * 0.8);
    const logo = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(inner, inner, {
        fit: "contain",
        position: "centre",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: MASKABLE_BG,
      },
    })
      .composite([{ input: logo, gravity: "center" }])
      .png()
      .toBuffer();
  }

  return sharp(input, { failOn: "none" })
    .rotate()
    .resize(size, size, {
      fit: "contain",
      position: "centre",
      background: ICON_BG,
    })
    .png()
    .toBuffer();
}

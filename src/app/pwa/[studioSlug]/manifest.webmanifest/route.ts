import type { MetadataRoute } from "next";
import { getStudioPathFromRequest } from "@/lib/app-url";
import { NextResponse } from "next/server";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import {
  PWA_ICON_VARIANTS,
  studioPwaIconPath,
  type PwaIconVariant,
} from "@/lib/pwaIcons";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  params: Promise<{ studioSlug: string }>;
};

function studioPwaManifestIcons(studioSlug: string): MetadataRoute.Manifest["icons"] {
  const manifestSizes: Record<PwaIconVariant, { sizes: string; purpose: "any" | "maskable" }> = {
    "180": { sizes: "180x180", purpose: "any" },
    "192": { sizes: "192x192", purpose: "any" },
    "512": { sizes: "512x512", purpose: "any" },
    maskable: { sizes: "512x512", purpose: "maskable" },
  };
  return PWA_ICON_VARIANTS.map((variant) => ({
    src: studioPwaIconPath(studioSlug, variant),
    sizes: manifestSizes[variant].sizes,
    type: "image/png",
    purpose: manifestSizes[variant].purpose,
  }));
}

function buildManifest({
  appPath,
  name,
  description,
  logoUrl,
  studioSlug,
}: {
  appPath: string;
  name: string;
  description: string;
  logoUrl?: string | null;
  studioSlug?: string | null;
}): MetadataRoute.Manifest {
  const hasStudioLogo =
    Boolean(studioSlug) && Boolean(logoUrl && isTrustedCoverImageUrl(logoUrl));
  const platformFallbackIcons = [
    {
      src: "/icons/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
      purpose: "any" as const,
    },
    {
      src: "/icons/icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any" as const,
    },
    {
      src: "/icons/icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "maskable" as const,
    },
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any" as const,
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any" as const,
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable" as const,
    },
  ];
  return {
    id: appPath,
    name,
    short_name: name.slice(0, 12) || "Studio",
    description,
    start_url: appPath,
    scope: appPath,
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f4ef",
    theme_color: "#0f766e",
    lang: "en",
    categories: ["health", "fitness", "lifestyle"],
    prefer_related_applications: false,
    icons: hasStudioLogo && studioSlug
      ? studioPwaManifestIcons(studioSlug)
      : platformFallbackIcons,
  };
}

export async function GET(req: Request, { params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  const MANIFEST_HEADERS = {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  };

  if (!studioSlug || isReservedPublicSlug(studioSlug)) {
    return NextResponse.json(
      buildManifest({
        appPath: "/studio",
        name: "Studio",
        description: "Studio storefront",
        logoUrl: null,
      }),
      { headers: MANIFEST_HEADERS },
    );
  }

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("name, public_brand_name, public_intro, public_logo_url, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();

  if (!studio || studio.contract_status === "suspended") {
    return NextResponse.json(
      buildManifest({
        appPath: getStudioPathFromRequest(req, studioSlug),
        name: "Studio",
        description: "Studio storefront",
        logoUrl: null,
      }),
      { headers: MANIFEST_HEADERS },
    );
  }

  const name =
    studio.public_brand_name?.trim() ||
    studio.name?.trim() ||
    "Studio";
  const description =
    studio.public_intro?.trim() ||
    `Browse classes, packages, and bookings for ${name}.`;

  return NextResponse.json(
      buildManifest({
        appPath: getStudioPathFromRequest(req, studioSlug),
        name,
        description,
        logoUrl: studio.public_logo_url ?? null,
        studioSlug,
      }),
    { headers: MANIFEST_HEADERS },
  );
}

import type { MetadataRoute } from "next";
import { NextResponse } from "next/server";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  params: Promise<{ studioSlug: string }>;
};

function inferImageMimeType(url: string): "image/webp" | "image/jpeg" | "image/png" | null {
  const normalized = url.trim().toLowerCase().split("?")[0]?.split("#")[0] ?? "";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".png")) return "image/png";
  return null;
}

function buildManifest({
  studioSlug,
  name,
  description,
  logoUrl,
}: {
  studioSlug: string;
  name: string;
  description: string;
  logoUrl?: string | null;
}): MetadataRoute.Manifest {
  const trustedLogoUrl = logoUrl && isTrustedCoverImageUrl(logoUrl) ? logoUrl : null;
  const trustedLogoType = trustedLogoUrl ? inferImageMimeType(trustedLogoUrl) : null;
  return {
    id: `/${studioSlug}`,
    name,
    short_name: name.slice(0, 12) || "Studio",
    description,
    start_url: `/${studioSlug}`,
    scope: `/${studioSlug}`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f4ef",
    theme_color: "#0f766e",
    lang: "en",
    categories: ["health", "fitness", "lifestyle"],
    prefer_related_applications: false,
    icons: trustedLogoUrl
      ? [
          // Actual logo — declare real size (800x800 from our crop)
          {
            src: trustedLogoUrl,
            sizes: "800x800",
            ...(trustedLogoType ? { type: trustedLogoType } : {}),
            purpose: "any",
          },
        ]
      : [],
  };
}

export async function GET(_: Request, { params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  const MANIFEST_HEADERS = {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  };

  if (!studioSlug || isReservedPublicSlug(studioSlug)) {
    return NextResponse.json(
      buildManifest({
        studioSlug: "studio",
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
        studioSlug,
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
      studioSlug,
      name,
      description,
      logoUrl: studio.public_logo_url ?? null,
    }),
    { headers: MANIFEST_HEADERS },
  );
}

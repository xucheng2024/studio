import type { MetadataRoute } from "next";
import { getStudioPathFromRequest } from "@/lib/app-url";
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
  appPath,
  name,
  description,
  logoUrl,
}: {
  appPath: string;
  name: string;
  description: string;
  logoUrl?: string | null;
}): MetadataRoute.Manifest {
  const trustedLogoUrl = logoUrl && isTrustedCoverImageUrl(logoUrl) ? logoUrl : null;
  const trustedLogoType = trustedLogoUrl ? inferImageMimeType(trustedLogoUrl) : null;
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
    icons: [
      // Static branded fallback — always present so browsers can install the PWA
      // even when the studio has no logo. Two entries so both "any" and "maskable"
      // purposes are declared (Next.js Manifest type does not allow combined strings).
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      // Studio logo when available (arbitrary crop — "any" only, no safe-zone guarantee)
      ...(trustedLogoUrl
        ? [
            {
              src: trustedLogoUrl,
              sizes: "800x800",
              type: trustedLogoType ?? undefined,
              purpose: "any" as const,
            },
          ]
        : []),
    ],
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
    }),
    { headers: MANIFEST_HEADERS },
  );
}

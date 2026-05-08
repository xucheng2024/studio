import type { MetadataRoute } from "next";
import { NextResponse } from "next/server";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  params: Promise<{ studioSlug: string }>;
};

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
  return {
    id: `/${studioSlug}`,
    name,
    short_name: name.slice(0, 12) || "Studio",
    description,
    start_url: `/${studioSlug}`,
    scope: `/${studioSlug}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f4ef",
    theme_color: "#0f766e",
    icons: trustedLogoUrl
      ? [
          {
            src: trustedLogoUrl,
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: trustedLogoUrl,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ]
      : [
          {
            src: "/favicon.ico",
            sizes: "any",
            type: "image/x-icon",
          },
        ],
  };
}

export async function GET(_: Request, { params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  if (!studioSlug || isReservedPublicSlug(studioSlug)) {
    return NextResponse.json(
      buildManifest({
        studioSlug: "studio",
        name: "Studio",
        description: "Studio storefront",
        logoUrl: null,
      }),
      {
        headers: {
          "Content-Type": "application/manifest+json; charset=utf-8",
        },
      },
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
      {
        headers: {
          "Content-Type": "application/manifest+json; charset=utf-8",
        },
      },
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
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
      },
    },
  );
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import {
  parsePwaIconVariant,
  platformPwaFallbackFile,
  pwaIconPublicUrlFromLogoUrl,
  renderPwaIconPng,
} from "@/lib/pwaIcons";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

type Props = {
  params: Promise<{ studioSlug: string; variant: string }>;
};

const PNG_HEADERS = {
  "Content-Type": "image/png",
  "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
};

async function readPlatformFallback(variant: NonNullable<ReturnType<typeof parsePwaIconVariant>>) {
  const file = platformPwaFallbackFile(variant);
  return readFile(path.join(process.cwd(), "public", "icons", file));
}

function pngResponse(buffer: Buffer) {
  return new NextResponse(new Uint8Array(buffer), { headers: PNG_HEADERS });
}

export async function GET(_req: Request, { params }: Props) {
  const { studioSlug: rawStudioSlug, variant: rawVariant } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);
  const variant = parsePwaIconVariant(rawVariant);

  if (!variant) {
    return new NextResponse("not_found", { status: 404 });
  }

  if (!studioSlug || isReservedPublicSlug(studioSlug)) {
    return pngResponse(await readPlatformFallback(variant));
  }

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("public_logo_url, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();

  const logoUrl = studio?.public_logo_url;
  if (
    !studio ||
    studio.contract_status === "suspended" ||
    !logoUrl ||
    !isTrustedCoverImageUrl(logoUrl)
  ) {
    return pngResponse(await readPlatformFallback(variant));
  }

  const preGeneratedUrl = pwaIconPublicUrlFromLogoUrl(logoUrl, variant);
  if (preGeneratedUrl) {
    try {
      const preGenerated = await fetch(preGeneratedUrl, { cache: "no-store" });
      if (preGenerated.ok) {
        return pngResponse(Buffer.from(await preGenerated.arrayBuffer()));
      }
    } catch {
      // Fall through to on-the-fly render from the main logo.
    }
  }

  try {
    const logoRes = await fetch(logoUrl, { cache: "no-store" });
    if (!logoRes.ok) {
      return pngResponse(await readPlatformFallback(variant));
    }
    const png = await renderPwaIconPng(Buffer.from(await logoRes.arrayBuffer()), variant);
    return pngResponse(png);
  } catch {
    return pngResponse(await readPlatformFallback(variant));
  }
}

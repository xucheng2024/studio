import type { Metadata } from "next";
import { getPublicStudioShell } from "@/lib/cachedPublicStudio";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { getCanonicalUrlForStudioPath } from "@/lib/requestOrigin";

type BuildStudioListMetadataInput = {
  studioSlugRaw: string;
  title: string;
  description: string;
  path: string;
};

export async function buildStudioListMetadata({
  studioSlugRaw,
  title,
  description,
  path,
}: BuildStudioListMetadataInput): Promise<Metadata> {
  const studio = await getPublicStudioShell(studioSlugRaw);
  if (!studio) return { title };

  const pageTitle = `${title} · ${studio.name}`;
  const desc = description.trim() || `Explore ${title.toLowerCase()} at ${studio.name}.`;
  const canonicalUrl = await getCanonicalUrlForStudioPath(
    path,
    studio.public_slug,
    (studio as { custom_domain?: string | null }).custom_domain ?? null,
    (studio as { custom_domain_status?: string | null }).custom_domain_status ?? null,
  );
  const cover = studio.public_cover_image_url && isTrustedCoverImageUrl(studio.public_cover_image_url)
    ? studio.public_cover_image_url
    : absolutePlaceholderCoverUrl();

  return {
    title: pageTitle,
    description: desc,
    ...(canonicalUrl ? { alternates: { canonical: canonicalUrl } } : {}),
    openGraph: {
      title: pageTitle,
      description: desc,
      type: "website",
      images: [{ url: cover, width: 1200, height: 675, alt: studio.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: desc,
      images: [cover],
    },
  };
}

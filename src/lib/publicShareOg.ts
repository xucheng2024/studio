import type { Metadata } from "next";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { getRequestOriginForOg } from "@/lib/requestOrigin";
import { getCachedClassShareContext, getCachedEventShareContext, getCachedMemberZoneShareContext, getCachedMembershipShareContext, getCachedPackageShareContext, getCachedServiceShareContext } from "@/lib/cachedSharePages";
import { studioClassPath, studioEventPath, studioMemberZonePath, studioMembershipPath, studioPackagePath, studioServicePath } from "@/lib/public-paths";

type ShareMetadataInput = {
  path: string;
  pageTitle: string;
  socialTitle: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
};

async function withCanonical(path: string, metadata: Metadata): Promise<Metadata> {
  const origin = await getRequestOriginForOg();
  if (!origin) return metadata;
  return {
    ...metadata,
    alternates: { canonical: `${origin}${path}` },
  };
}

function trustedImageOrFallback(url: string | null | undefined) {
  return url && isTrustedCoverImageUrl(url) ? url : absolutePlaceholderCoverUrl();
}

function shortText(value: string, max = 200) {
  return value.slice(0, max);
}

async function buildShareMetadata({
  path,
  pageTitle,
  socialTitle,
  description,
  imageUrl,
  imageAlt,
}: ShareMetadataInput): Promise<Metadata> {
  return withCanonical(path, {
    title: pageTitle,
    description,
    openGraph: {
      title: socialTitle,
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 675, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [imageUrl],
    },
  });
}

export async function buildClassShareMetadata(
  studioSlugRaw: string,
  classSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedClassShareContext(studioSlugRaw, classSlugRaw);
  if (!ctx) return { title: "Class booking" };
  const { studio, cls } = ctx;

  const img = trustedImageOrFallback(cls.image_url);
  const desc = cls.description ? shortText(String(cls.description)) : `Book ${cls.title} at ${studio.name}`;
  const path = studioClassPath(studio.public_slug, cls.share_slug ?? classSlugRaw);

  return buildShareMetadata({
    path,
    pageTitle: `${cls.title} · ${studio.name}`,
    socialTitle: cls.title,
    description: desc,
    imageUrl: img,
    imageAlt: cls.title,
  });
}

export async function buildPackageShareMetadata(
  studioSlugRaw: string,
  packageSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedPackageShareContext(studioSlugRaw, packageSlugRaw);
  if (!ctx) return { title: "Package" };
  const { studio, pkg } = ctx;

  const img = absolutePlaceholderCoverUrl();
  const desc = `${studio.name} · ${pkg.credits} class passes · $${pkg.price}`;
  const path = studioPackagePath(studio.public_slug, pkg.share_slug ?? packageSlugRaw);

  return buildShareMetadata({
    path,
    pageTitle: `${pkg.name} · ${studio.name}`,
    socialTitle: pkg.name,
    description: desc,
    imageUrl: img,
    imageAlt: pkg.name,
  });
}

export async function buildMembershipShareMetadata(
  studioSlugRaw: string,
  membershipSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedMembershipShareContext(studioSlugRaw, membershipSlugRaw);
  if (!ctx) return { title: "Membership" };
  const { studio, membership } = ctx;

  const img = absolutePlaceholderCoverUrl();
  const intervalLabel = membership.billing_interval === "yearly" ? "Yearly" : "Monthly";
  const desc = `${studio.name} · ${intervalLabel} membership · $${membership.price}`;
  const path = studioMembershipPath(studio.public_slug, membership.share_slug ?? membershipSlugRaw);

  return buildShareMetadata({
    path,
    pageTitle: `${membership.name} · ${studio.name}`,
    socialTitle: membership.name,
    description: desc,
    imageUrl: img,
    imageAlt: membership.name,
  });
}

export async function buildServiceShareMetadata(
  studioSlugRaw: string,
  serviceSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedServiceShareContext(studioSlugRaw, serviceSlugRaw);
  if (!ctx) return { title: "Service" };
  const { studio, service } = ctx;

  const img = trustedImageOrFallback(service.cover_image_url);
  const desc = service.summary || service.description || `${service.title} at ${studio.name}`;
  const path = studioServicePath(studio.public_slug, service.share_slug ?? serviceSlugRaw);
  const shortDesc = shortText(String(desc));

  return buildShareMetadata({
    path,
    pageTitle: `${service.title} · ${studio.name}`,
    socialTitle: service.title,
    description: shortDesc,
    imageUrl: img,
    imageAlt: service.title,
  });
}

export async function buildEventShareMetadata(
  studioSlugRaw: string,
  eventSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedEventShareContext(studioSlugRaw, eventSlugRaw);
  if (!ctx) return { title: "Event" };
  const { studio, event } = ctx;

  const img = trustedImageOrFallback(event.image_url);
  const desc = event.description ? shortText(String(event.description)) : `Book ${event.title} at ${studio.name}`;
  const path = studioEventPath(studio.public_slug, event.share_slug ?? eventSlugRaw);

  return buildShareMetadata({
    path,
    pageTitle: `${event.title} · ${studio.name}`,
    socialTitle: event.title,
    description: desc,
    imageUrl: img,
    imageAlt: event.title,
  });
}

export async function buildMemberZoneShareMetadata(
  studioSlugRaw: string,
  seriesSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedMemberZoneShareContext(studioSlugRaw, seriesSlugRaw);
  if (!ctx) return { title: "Member zone" };
  const { studio, series } = ctx;

  const img = trustedImageOrFallback(series.cover_image_url);
  const desc = series.summary || series.description || `${series.title} by ${studio.name}`;
  const path = studioMemberZonePath(studio.public_slug, series.share_slug ?? seriesSlugRaw);
  const shortDesc = shortText(String(desc));

  return buildShareMetadata({
    path,
    pageTitle: `${series.title} · ${studio.name}`,
    socialTitle: series.title,
    description: shortDesc,
    imageUrl: img,
    imageAlt: series.title,
  });
}

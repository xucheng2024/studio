import type { Metadata } from "next";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { getAppOriginForOg } from "@/lib/coverMedia";
import { getCachedClassShareContext, getCachedEventShareContext, getCachedMemberZoneShareContext, getCachedMembershipShareContext, getCachedPackageShareContext, getCachedServiceShareContext } from "@/lib/cachedSharePages";
import { studioClassPath, studioEventPath, studioMemberZonePath, studioMembershipPath, studioPackagePath, studioServicePath } from "@/lib/public-paths";

function withCanonical(path: string, metadata: Metadata): Metadata {
  const origin = getAppOriginForOg();
  if (!origin) return metadata;
  return {
    ...metadata,
    alternates: { canonical: `${origin}${path}` },
  };
}

export async function buildClassShareMetadata(
  studioSlugRaw: string,
  classSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedClassShareContext(studioSlugRaw, classSlugRaw);
  if (!ctx) return { title: "Class booking" };
  const { studio, cls } = ctx;

  const img = cls.image_url && isTrustedCoverImageUrl(cls.image_url) ? cls.image_url : absolutePlaceholderCoverUrl();
  const desc = cls.description ? String(cls.description).slice(0, 200) : `Book ${cls.title} at ${studio.name}`;
  const path = studioClassPath(studio.public_slug, cls.share_slug ?? classSlugRaw);

  return withCanonical(path, {
    title: `${cls.title} · ${studio.name}`,
    description: desc,
    openGraph: {
      title: cls.title,
      description: desc,
      type: "website",
      images: [{ url: img, width: 1200, height: 675, alt: cls.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: cls.title,
      description: desc,
      images: [img],
    },
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

  return withCanonical(path, {
    title: `${pkg.name} · ${studio.name}`,
    description: desc,
    openGraph: {
      title: pkg.name,
      description: desc,
      type: "website",
      images: [{ url: img, width: 1200, height: 675, alt: pkg.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: pkg.name,
      description: desc,
      images: [img],
    },
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

  return withCanonical(path, {
    title: `${membership.name} · ${studio.name}`,
    description: desc,
    openGraph: {
      title: membership.name,
      description: desc,
      type: "website",
      images: [{ url: img, width: 1200, height: 675, alt: membership.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: membership.name,
      description: desc,
      images: [img],
    },
  });
}

export async function buildServiceShareMetadata(
  studioSlugRaw: string,
  serviceSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedServiceShareContext(studioSlugRaw, serviceSlugRaw);
  if (!ctx) return { title: "Service" };
  const { studio, service } = ctx;

  const img = service.cover_image_url && isTrustedCoverImageUrl(service.cover_image_url)
    ? service.cover_image_url
    : absolutePlaceholderCoverUrl();
  const desc = service.summary || service.description || `${service.title} at ${studio.name}`;
  const path = studioServicePath(studio.public_slug, service.share_slug ?? serviceSlugRaw);

  return withCanonical(path, {
    title: `${service.title} · ${studio.name}`,
    description: String(desc).slice(0, 200),
    openGraph: {
      title: service.title,
      description: String(desc).slice(0, 200),
      type: "website",
      images: [{ url: img, width: 1200, height: 675, alt: service.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: service.title,
      description: String(desc).slice(0, 200),
      images: [img],
    },
  });
}

export async function buildEventShareMetadata(
  studioSlugRaw: string,
  eventSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedEventShareContext(studioSlugRaw, eventSlugRaw);
  if (!ctx) return { title: "Event" };
  const { studio, event } = ctx;

  const img = event.image_url && isTrustedCoverImageUrl(event.image_url) ? event.image_url : absolutePlaceholderCoverUrl();
  const desc = event.description ? String(event.description).slice(0, 200) : `Book ${event.title} at ${studio.name}`;
  const path = studioEventPath(studio.public_slug, event.share_slug ?? eventSlugRaw);

  return withCanonical(path, {
    title: `${event.title} · ${studio.name}`,
    description: desc,
    openGraph: {
      title: event.title,
      description: desc,
      type: "website",
      images: [{ url: img, width: 1200, height: 675, alt: event.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: event.title,
      description: desc,
      images: [img],
    },
  });
}

export async function buildMemberZoneShareMetadata(
  studioSlugRaw: string,
  seriesSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedMemberZoneShareContext(studioSlugRaw, seriesSlugRaw);
  if (!ctx) return { title: "Member zone" };
  const { studio, series } = ctx;

  const img = series.cover_image_url && isTrustedCoverImageUrl(series.cover_image_url)
    ? series.cover_image_url
    : absolutePlaceholderCoverUrl();
  const desc = series.summary || series.description || `${series.title} by ${studio.name}`;
  const path = studioMemberZonePath(studio.public_slug, series.share_slug ?? seriesSlugRaw);

  return withCanonical(path, {
    title: `${series.title} · ${studio.name}`,
    description: String(desc).slice(0, 200),
    openGraph: {
      title: series.title,
      description: String(desc).slice(0, 200),
      type: "website",
      images: [{ url: img, width: 1200, height: 675, alt: series.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: series.title,
      description: String(desc).slice(0, 200),
      images: [img],
    },
  });
}

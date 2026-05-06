import type { Metadata } from "next";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { getCachedClassShareContext, getCachedEventShareContext, getCachedPackageShareContext, getCachedServiceShareContext } from "@/lib/cachedSharePages";

export async function buildClassShareMetadata(
  studioSlugRaw: string,
  classSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedClassShareContext(studioSlugRaw, classSlugRaw);
  if (!ctx) return { title: "Class booking" };
  const { studio, cls } = ctx;

  const img = cls.image_url && isTrustedCoverImageUrl(cls.image_url) ? cls.image_url : absolutePlaceholderCoverUrl();
  const desc = cls.description ? String(cls.description).slice(0, 200) : `Book ${cls.title} at ${studio.name}`;

  return {
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
  };
}

export async function buildPackageShareMetadata(
  studioSlugRaw: string,
  packageSlugRaw: string,
): Promise<Metadata> {
  const ctx = await getCachedPackageShareContext(studioSlugRaw, packageSlugRaw);
  if (!ctx) return { title: "Package" };
  const { studio, pkg } = ctx;

  const img = pkg.image_url && isTrustedCoverImageUrl(pkg.image_url) ? pkg.image_url : absolutePlaceholderCoverUrl();
  const desc = `${studio.name} · ${pkg.credits} class passes · $${pkg.price}`;

  return {
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
  };
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

  return {
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
  };
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

  return {
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
  };
}

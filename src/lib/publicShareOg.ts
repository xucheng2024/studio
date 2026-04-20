import type { Metadata } from "next";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { getCachedClassShareContext, getCachedPackageShareContext } from "@/lib/cachedSharePages";

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
  const desc = `${studio.name} · ${pkg.credits} credits · $${pkg.price}`;

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

import type { Metadata } from "next";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { normalizeStudioSlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

function normalizeClassSlug(raw: string) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePackageSlug(raw: string) {
  return normalizeClassSlug(raw);
}

export async function buildClassShareMetadata(
  studioSlugRaw: string,
  classSlugRaw: string,
): Promise<Metadata> {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const classSlug = normalizeClassSlug(classSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(classSlug)) {
    return { title: "Class booking" };
  }

  const supabase = await createClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") {
    return { title: "Class booking" };
  }

  const { data: cls } = await supabase
    .from("classes")
    .select("title, description, image_url")
    .eq("studio_id", studio.id)
    .eq("share_slug", classSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!cls) return { title: "Class booking" };

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
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  const pkgSlug = normalizePackageSlug(packageSlugRaw);
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(pkgSlug)) {
    return { title: "Package" };
  }

  const supabase = await createClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") {
    return { title: "Package" };
  }

  const { data: pkg } = await supabase
    .from("packages")
    .select("name, credits, price, image_url")
    .eq("studio_id", studio.id)
    .eq("share_slug", pkgSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!pkg) return { title: "Package" };

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

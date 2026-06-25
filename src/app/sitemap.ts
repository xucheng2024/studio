import type { MetadataRoute } from "next";
import { getAppOriginForOg } from "@/lib/coverMedia";
import { headers } from "next/headers";
import {
  isPlatformHost,
  normalizeCustomDomainHost,
  resolveActiveCustomDomainStudio,
} from "@/lib/customDomainLookup";
import {
  studioClassPath,
  studioEventPath,
  studioHomePath,
  studioMemberZonePath,
  studioMembershipPath,
  studioPackagePath,
  studioServicePath,
  studioShopProductPath,
} from "@/lib/public-paths";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 3600;

type SiteEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "daily" | "weekly";
  priority: number;
};

function stripStudioPrefix(path: string, studioSlug: string): string {
  const prefix = `/${studioSlug}`;
  if (path === prefix) return "/";
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const headerSlug = h.get("x-studio-slug")?.trim().toLowerCase() ?? "";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const normalizedHost = normalizeCustomDomainHost(host);
  const customDomainStudio = headerSlug && normalizedHost && !isPlatformHost(normalizedHost)
    ? { publicSlug: headerSlug, customDomain: normalizedHost }
    : await resolveActiveCustomDomainStudio(host);
  const origin = customDomainStudio
    ? `https://${customDomainStudio.customDomain}`
    : getAppOriginForOg();
  if (!origin) return [];

  const admin = createAdminClient();
  const { data: studios } = await admin
    .from("studios")
    .select("id, public_slug, created_at")
    .neq("contract_status", "suspended")
    .not("public_slug", "is", null);

  const now = new Date();
  const studioMap = new Map<string, string>();
  for (const studio of studios ?? []) {
    const slug = String(studio.public_slug ?? "").trim();
    if (!slug || isReservedPublicSlug(slug)) continue;
    studioMap.set(studio.id, slug);
  }

  const [
    { data: services },
    { data: classes },
    { data: events },
    { data: packages },
    { data: memberships },
    { data: series },
    { data: products },
  ] = await Promise.all([
    admin.from("studio_services").select("studio_id, share_slug, created_at").eq("is_active", true).not("share_slug", "is", null),
    admin.from("classes").select("studio_id, share_slug, created_at").eq("is_active", true).not("share_slug", "is", null),
    admin.from("events").select("studio_id, share_slug, created_at").eq("is_active", true).not("share_slug", "is", null),
    admin.from("packages").select("studio_id, share_slug, created_at").eq("is_active", true).is("deleted_at", null).not("share_slug", "is", null),
    admin.from("membership_products").select("studio_id, share_slug, created_at").eq("is_active", true).is("deleted_at", null).not("share_slug", "is", null),
    admin.from("member_zone_series").select("studio_id, share_slug, created_at").eq("is_active", true).not("share_slug", "is", null),
    admin.from("shop_products").select("studio_id, share_slug, created_at").eq("is_active", true).not("share_slug", "is", null),
  ]);

  const entries: SiteEntry[] = [];
  for (const studio of studios ?? []) {
    const slug = studioMap.get(studio.id);
    if (!slug) continue;
    if (customDomainStudio && slug !== customDomainStudio.publicSlug) continue;
    entries.push({
      url: `${origin}${customDomainStudio ? "/" : studioHomePath(slug)}`,
      lastModified: studio.created_at ? new Date(studio.created_at) : now,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  const pushRows = (
    rows: Array<{ studio_id: string; share_slug: string | null; created_at?: string | null }>,
    toPath: (studioSlug: string, shareSlug: string) => string,
  ) => {
    for (const row of rows) {
      const studioSlug = studioMap.get(row.studio_id);
      const shareSlug = String(row.share_slug ?? "").trim();
      if (!studioSlug || !shareSlug) continue;
      if (customDomainStudio && studioSlug !== customDomainStudio.publicSlug) continue;
      const path = toPath(studioSlug, shareSlug);
      entries.push({
        url: `${origin}${customDomainStudio ? stripStudioPrefix(path, studioSlug) : path}`,
        lastModified: row.created_at ? new Date(row.created_at) : now,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  };

  pushRows(services ?? [], studioServicePath);
  pushRows(classes ?? [], studioClassPath);
  pushRows(events ?? [], studioEventPath);
  pushRows(packages ?? [], studioPackagePath);
  pushRows(memberships ?? [], studioMembershipPath);
  pushRows(series ?? [], studioMemberZonePath);
  pushRows(products ?? [], studioShopProductPath);

  return entries;
}

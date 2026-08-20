import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { resolveActiveCustomDomainStudio } from "@/lib/customDomainLookup";
import { getAppOriginForOg } from "@/lib/coverMedia";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const customDomainStudio = await resolveActiveCustomDomainStudio(host);
  const origin = customDomainStudio
    ? `https://${customDomainStudio.customDomain}`
    : getAppOriginForOg();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard/", "/api/"],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}

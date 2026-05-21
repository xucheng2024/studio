import type { MetadataRoute } from "next";
import { getAppOriginForOg } from "@/lib/coverMedia";

export default function robots(): MetadataRoute.Robots {
  const origin = getAppOriginForOg();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard/", "/api/", "/_next/"],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}

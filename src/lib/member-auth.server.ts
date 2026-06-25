import "server-only";

import { headers } from "next/headers";
import { resolveActiveCustomDomainStudio } from "@/lib/customDomainLookup";

export const CUSTOM_DOMAIN_STUDIO_HEADER = "x-studio-slug";

export async function resolveStudioSlugForCustomHost(hostRaw: string | null | undefined): Promise<string | null> {
  const studio = await resolveActiveCustomDomainStudio(hostRaw);
  return studio?.publicSlug ?? null;
}

export async function resolveStudioSlugFromCurrentHost(): Promise<string | null> {
  const h = await headers();
  const headerSlug = h.get(CUSTOM_DOMAIN_STUDIO_HEADER)?.trim().toLowerCase();
  if (headerSlug) return headerSlug;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return resolveStudioSlugForCustomHost(host);
}

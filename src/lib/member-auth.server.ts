import "server-only";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export const CUSTOM_DOMAIN_STUDIO_HEADER = "x-studio-slug";

const APP_HOSTNAME = (process.env.NEXT_PUBLIC_APP_URL ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .replace(/:\d+$/, "")
  .toLowerCase();

function normalizeHost(host: string | null | undefined) {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export async function resolveStudioSlugForCustomHost(hostRaw: string | null | undefined): Promise<string | null> {
  const host = normalizeHost(hostRaw);
  if (!host || !APP_HOSTNAME || host === APP_HOSTNAME) return null;

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("public_slug")
    .ilike("custom_domain", host)
    .neq("contract_status", "suspended")
    .limit(1)
    .maybeSingle<{ public_slug: string | null }>();

  return studio?.public_slug?.trim().toLowerCase() || null;
}

export async function resolveStudioSlugFromCurrentHost(): Promise<string | null> {
  const h = await headers();
  const headerSlug = h.get(CUSTOM_DOMAIN_STUDIO_HEADER)?.trim().toLowerCase();
  if (headerSlug) return headerSlug;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return resolveStudioSlugForCustomHost(host);
}

import { createAdminClient } from "@/lib/supabase/admin";

const APP_HOSTNAME = (process.env.NEXT_PUBLIC_APP_URL ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .replace(/:\d+$/, "")
  .toLowerCase();

export type ActiveCustomDomainStudio = {
  publicSlug: string;
  customDomain: string;
};

export function normalizeCustomDomainHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export function isPlatformHost(host: string): boolean {
  return Boolean(host && APP_HOSTNAME && host === APP_HOSTNAME);
}

export async function resolveActiveCustomDomainStudio(
  hostRaw: string | null | undefined,
): Promise<ActiveCustomDomainStudio | null> {
  const host = normalizeCustomDomainHost(hostRaw);
  if (!host || isPlatformHost(host) || !APP_HOSTNAME) return null;

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("public_slug, custom_domain")
    .eq("custom_domain", host)
    // Allow domains that already reach this app to resolve before the async
    // DNS/SSL verification flow has refreshed the saved status to active.
    .in("custom_domain_status", ["active", "pending"])
    .neq("contract_status", "suspended")
    .limit(1)
    .maybeSingle<{ public_slug: string | null; custom_domain: string | null }>();

  const publicSlug = studio?.public_slug?.trim().toLowerCase();
  const customDomain = studio?.custom_domain?.trim().toLowerCase();
  if (!publicSlug || !customDomain) return null;

  return {
    publicSlug,
    customDomain,
  };
}

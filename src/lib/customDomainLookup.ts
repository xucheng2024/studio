import {
  customDomainHostCandidates,
  normalizeCustomDomainInput,
} from "@/lib/customDomain";
import { createAdminClient } from "@/lib/supabase/admin";

const APP_HOSTNAME = (process.env.NEXT_PUBLIC_APP_URL ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .replace(/:\d+$/, "")
  .toLowerCase();

export type ActiveCustomDomainStudio = {
  publicSlug: string;
  customDomain: string;
  customDomainStatus: "active" | "pending";
};

export function normalizeCustomDomainHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export function isPlatformHost(host: string): boolean {
  return Boolean(host && APP_HOSTNAME && host === APP_HOSTNAME);
}

function toActiveStudio(row: {
  public_slug: string | null;
  custom_domain: string | null;
  custom_domain_status: string | null;
} | null): ActiveCustomDomainStudio | null {
  const publicSlug = row?.public_slug?.trim().toLowerCase() ?? "";
  const customDomain = normalizeCustomDomainInput(row?.custom_domain ?? "");
  const customDomainStatus = row?.custom_domain_status === "active" || row?.custom_domain_status === "pending"
    ? row.custom_domain_status
    : null;
  if (!publicSlug || !customDomain || !customDomainStatus) return null;
  return { publicSlug, customDomain, customDomainStatus };
}

export async function resolveActiveCustomDomainStudio(
  hostRaw: string | null | undefined,
): Promise<ActiveCustomDomainStudio | null> {
  const host = normalizeCustomDomainHost(hostRaw);
  if (!host || isPlatformHost(host) || !APP_HOSTNAME) return null;

  const candidates = customDomainHostCandidates(host);
  if (candidates.length === 0) return null;

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("public_slug, custom_domain, custom_domain_status")
    .in("custom_domain", candidates)
    // Allow domains that already reach this app to resolve before the async
    // DNS/SSL verification flow has refreshed the saved status to active.
    .in("custom_domain_status", ["active", "pending"])
    .neq("contract_status", "suspended")
    .limit(1)
    .maybeSingle<{
      public_slug: string | null;
      custom_domain: string | null;
      custom_domain_status: string | null;
    }>();

  return toActiveStudio(studio);
}

export async function resolveStudioCustomDomainBySlug(
  slugRaw: string | null | undefined,
): Promise<ActiveCustomDomainStudio | null> {
  const publicSlug = (slugRaw ?? "").trim().toLowerCase();
  if (!publicSlug || !APP_HOSTNAME) return null;

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("public_slug, custom_domain, custom_domain_status")
    .eq("public_slug", publicSlug)
    .neq("contract_status", "suspended")
    .limit(1)
    .maybeSingle<{
      public_slug: string | null;
      custom_domain: string | null;
      custom_domain_status: string | null;
    }>();

  return toActiveStudio(studio);
}

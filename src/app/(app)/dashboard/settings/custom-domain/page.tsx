import { DashboardAppLink } from "@/components/DashboardAppLink";
import { CustomDomainSettingsForm } from "@/components/dashboard/CustomDomainSettingsForm";
import { getCnameTargetFromEnv, toCustomDomainUiStatus } from "@/lib/customDomain";
import { getDashboardScope } from "@/lib/dashboard";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(path: string, studioId: string | null, locationId: string | null) {
  const p = new URLSearchParams();
  if (studioId) p.set("studio_id", studioId);
  if (locationId) p.set("location_id", locationId);
  return p.toString() ? `${path}?${p.toString()}` : path;
}

export default async function StudioCustomDomainPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const studioId = selectedStudioId ?? studioIds[0] ?? null;
  if (!studioId) return <p className={ui.muted}>Create a studio first.</p>;
  const canManageStudio =
    ctx.isSuperAdmin
    || ctx.memberships.some(
      (m) => m.studio_id === studioId && (m.role === "owner" || m.role === "manager"),
    );
  if (!canManageStudio) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, custom_domain, custom_domain_kind, custom_domain_status, custom_domain_vercel_status, custom_domain_dns_status, custom_domain_ssl_status, custom_domain_last_verified_at, custom_domain_last_error")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  const status = toCustomDomainUiStatus({
    domain: studio.custom_domain ?? null,
    kind: (studio as { custom_domain_kind?: "subdomain" | "apex" | null }).custom_domain_kind ?? null,
    overallStatus: (studio as { custom_domain_status?: "not_configured" | "pending" | "misconfigured" | "active" | null }).custom_domain_status ?? (studio.custom_domain ? "pending" : "not_configured"),
    vercelStatus: (studio as { custom_domain_vercel_status?: "not_configured" | "registered" | "failed" | "unknown" | null }).custom_domain_vercel_status ?? (studio.custom_domain ? "unknown" : "not_configured"),
    dnsStatus: (studio as { custom_domain_dns_status?: "not_configured" | "verified" | "pending" | "misconfigured" | "unknown" | null }).custom_domain_dns_status ?? (studio.custom_domain ? "pending" : "not_configured"),
    sslStatus: (studio as { custom_domain_ssl_status?: "not_configured" | "ready" | "pending" | "unknown" | null }).custom_domain_ssl_status ?? (studio.custom_domain ? "pending" : "not_configured"),
    lastVerifiedAt: (studio as { custom_domain_last_verified_at?: string | null }).custom_domain_last_verified_at ?? null,
    lastError: (studio as { custom_domain_last_error?: string | null }).custom_domain_last_error ?? null,
  });
  const cnameTarget = getCnameTargetFromEnv();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Custom Domain</h1>
          <p className={ui.muted}>Connect your own domain to /{studio.public_slug} and verify the live setup.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId, selectedLocationId)} className={ui.btnSecondarySm}>
          Back to settings
        </DashboardAppLink>
      </div>

      <CustomDomainSettingsForm
        studioId={studio.id}
        initialDomain={studio.custom_domain ?? null}
        cnameTarget={cnameTarget}
        status={status}
      />
    </div>
  );
}

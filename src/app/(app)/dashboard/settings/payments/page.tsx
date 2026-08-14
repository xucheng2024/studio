import { DashboardAppLink } from "@/components/DashboardAppLink";
import { HitpaySettingsForm } from "@/components/dashboard/HitpaySettingsForm";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function DashboardPaymentSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { studioIds, selectedStudioId } = await getDashboardScopeForRoles({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: null,
  }, ["owner"]);
  if (studioIds.length === 0) return <p className={ui.muted}>Only owners can update payment settings.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, hitpay_enabled, hitpay_business_name")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;
  const admin = createAdminClient();
  const { data: secrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key, hitpay_webhook_salt")
    .eq("studio_id", studio.id)
    .maybeSingle();
  const hasApiKey = Boolean(secrets?.hitpay_api_key);
  const hasWebhookSalt = Boolean(secrets?.hitpay_webhook_salt);
  const apiBase = process.env.HITPAY_API_BASE_URL?.trim() || "https://api.hit-pay.com";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/settings" className={`${ui.btnSecondarySm} mb-3`}>
          ← Settings
        </DashboardAppLink>
        <h1 className={ui.h1}>Payment settings</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Configure {studio.name}&apos;s independent HitPay merchant account.
        </p>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>HitPay API endpoint</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          This server-wide endpoint is used for every studio. Choose the HitPay Sandbox or Production URL in the
          server environment; each studio supplies only its own merchant credentials below.
        </p>
        <p className={`mt-3 text-sm ${ui.muted}`}>`hitpay_api_base_url`: {apiBase}</p>
      </section>

      <HitpaySettingsForm
        studioId={studio.id}
        initialEnabled={Boolean(studio.hitpay_enabled)}
        initialBusinessName={studio.hitpay_business_name ?? null}
        initialHasApiKey={hasApiKey}
        initialHasWebhookSalt={hasWebhookSalt}
      />

      <section className={ui.card}>
        <h2 className={ui.h2}>Configuration status</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          This studio is ready for checkout when it is enabled and its merchant API key and webhook salt are stored.
        </p>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          If all status lines below are configured and enabled, customers can use HitPay checkout without support
          intervention.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-stone-700 dark:text-stone-300">
          <li>`hitpay_enabled`: {studio.hitpay_enabled ? "enabled" : "disabled"}</li>
          <li>`hitpay_api_key`: {hasApiKey ? "configured" : "missing"}</li>
          <li>`hitpay_webhook_salt`: {hasWebhookSalt ? "configured" : "missing"}</li>
        </ul>
      </section>
    </div>
  );
}

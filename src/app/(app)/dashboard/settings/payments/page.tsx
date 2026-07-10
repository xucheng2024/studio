import { DashboardAppLink } from "@/components/DashboardAppLink";
import { HitpaySettingsForm } from "@/components/dashboard/HitpaySettingsForm";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { CheckCircle2, CircleAlert } from "lucide-react";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function DashboardPaymentSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const isSuperAdmin = isSuperAdminEmail(user.email);

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
  const hasPlatformKey = Boolean(process.env.HITPAY_PLATFORM_API_KEY?.trim());
  const apiBase = process.env.HITPAY_API_BASE_URL?.trim() || "https://api.hit-pay.com";
  const platformReady = hasPlatformKey;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/settings" className={`${ui.btnSecondarySm} mb-3`}>
          ← Settings
        </DashboardAppLink>
        <h1 className={ui.h1}>Payment settings</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Configure how {studio.name} connects as a sub-merchant under your platform-level HitPay setup.
        </p>
      </div>

      {isSuperAdmin ? (
        <section className={ui.card}>
          <h2 className={ui.h2}>Platform integration</h2>
          <p className={`mt-2 text-sm ${ui.muted}`}>
            These are platform-level server settings for your SaaS account. They are shared across studios and are not
            editable from a studio form.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-stone-700 dark:text-stone-300">
            <li>`hitpay_api_base_url`: {apiBase}</li>
            <li>`hitpay_platform_api_key`: {hasPlatformKey ? "configured" : "missing on server"}</li>
          </ul>
          <p className={`mt-3 text-xs ${ui.muted}`}>
            Set `HITPAY_PLATFORM_API_KEY` in your server environment. Studio owners should not manage this key.
          </p>
        </section>
      ) : null}

      <section className={ui.card}>
        <h2 className={ui.h2}>Setup progress</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          Owners can complete the studio layer here. The shared platform key is a server setting and must already be
          configured by the platform admin.
        </p>
        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950/50">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center ${
                platformReady ? "text-teal-600 dark:text-teal-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {platformReady ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Platform ready</h3>
                <span className={platformReady ? ui.badge : ui.badgeAmber}>
                  {platformReady ? "Ready" : "Pending"}
                </span>
              </div>
              <p className={`mt-1 text-sm ${ui.muted}`}>
                {platformReady
                  ? "The shared server key is configured. Continue with this studio's merchant credentials below."
                  : "Ask the platform admin to configure HITPAY_PLATFORM_API_KEY before enabling payments for this studio."}
              </p>
            </div>
          </div>
        </div>
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
          Platform mode has two layers. The platform admin owns the shared server key. The studio owner owns the
          merchant business name, merchant API key, webhook salt, and enable switch on this page.
        </p>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          If all four status lines below are configured and enabled, customers can use HitPay checkout without support
          intervention.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-stone-700 dark:text-stone-300">
          <li>`hitpay_enabled`: {studio.hitpay_enabled ? "enabled" : "disabled"}</li>
          <li>`hitpay_platform_api_key`: {hasPlatformKey ? "configured" : "missing on server"}</li>
          <li>`hitpay_api_key`: {hasApiKey ? "configured" : "missing"}</li>
          <li>`hitpay_webhook_salt`: {hasWebhookSalt ? "configured" : "missing"}</li>
        </ul>
      </section>
    </div>
  );
}

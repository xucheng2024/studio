import { updateStudioHitpaySettings } from "@/app/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { Toggle } from "@/components/ui/Toggle";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
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

  const { ctx, studioIds, selectedStudioId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0) return <p className={ui.muted}>Create a studio first.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  if (bestRole(ctx) !== "owner") {
    return <p className={ui.muted}>Only owners can update payment settings.</p>;
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

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/settings" className={`${ui.btnSecondarySm} mb-3`}>
          ← Settings
        </DashboardAppLink>
        <h1 className={ui.h1}>Payment settings</h1>
        <p className={`mt-1 ${ui.muted}`}>Configure {studio.name} own HitPay merchant credentials.</p>
      </div>

      <form action={updateStudioHitpaySettings} className={`${ui.card} grid gap-4`}>
        <input type="hidden" name="studio_id" value={studio.id} />
        <label className="flex items-center gap-3 text-sm text-stone-700 dark:text-stone-300">
          <Toggle name="hitpay_enabled" defaultChecked={Boolean(studio.hitpay_enabled)} />
          Enable HitPay for this studio
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Business name</span>
          <input
            name="hitpay_business_name"
            defaultValue={studio.hitpay_business_name ?? ""}
            placeholder="ACME Fitness Pte Ltd"
            className={ui.input}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>HitPay API key</span>
          <input
            name="hitpay_api_key"
            type="password"
            defaultValue=""
            placeholder={hasApiKey ? "Configured (enter new key to rotate)" : "business-api-key"}
            className={ui.input}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Webhook salt</span>
          <input
            name="hitpay_webhook_salt"
            type="password"
            defaultValue=""
            placeholder={hasWebhookSalt ? "Configured (enter new salt to rotate)" : "webhook-salt"}
            className={ui.input}
          />
        </label>
        <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Saving...">
          Save settings
        </SubmitButton>
      </form>

      <section className={ui.card}>
        <h2 className={ui.h2}>Configuration status</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          Each studio can bring its own HitPay account and keys. Credentials are used only for this studio payment
          creation and webhook validation.
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

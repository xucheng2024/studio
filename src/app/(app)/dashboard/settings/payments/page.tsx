import { updateStudioHitpaySettings } from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { Toggle } from "@/components/ui/Toggle";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { CheckCircle2, CircleDashed } from "lucide-react";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

function OnboardingStep({
  title,
  description,
  done,
}: {
  title: string;
  description: string;
  done: boolean;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center ${
            done ? "text-teal-600 dark:text-teal-400" : "text-stone-400 dark:text-stone-500"
          }`}
        >
          {done ? <CheckCircle2 size={18} /> : <CircleDashed size={18} />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                done
                  ? "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
                  : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
              }`}
            >
              {done ? "Ready" : "Pending"}
            </span>
          </div>
          <p className={`mt-1 text-sm ${ui.muted}`}>{description}</p>
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPaymentSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const isSuperAdmin = isSuperAdminEmail(user.email);

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
  const hasPlatformKey = Boolean(process.env.HITPAY_PLATFORM_API_KEY?.trim());
  const apiBase = process.env.HITPAY_API_BASE_URL?.trim() || "https://api.hit-pay.com";
  const hasBusinessName = Boolean(studio.hitpay_business_name?.trim());
  const platformReady = hasPlatformKey;
  const merchantAccountReady = hasBusinessName;
  const credentialsEntered = hasApiKey && hasWebhookSalt;
  const enabled = Boolean(studio.hitpay_enabled) && platformReady && credentialsEntered;

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
          Complete these steps to turn on HitPay for this studio with fewer surprises.
        </p>
        <div className="mt-4 grid gap-3">
          {isSuperAdmin ? (
            <OnboardingStep
              title="1. Platform ready"
              description="Your SaaS server has the shared HitPay platform key configured."
              done={platformReady}
            />
          ) : null}
          <OnboardingStep
            title={isSuperAdmin ? "2. Merchant account ready" : "1. Merchant account ready"}
            description="Confirm this studio has its own HitPay merchant account and use the business name below to match that account."
            done={merchantAccountReady}
          />
          <OnboardingStep
            title={isSuperAdmin ? "3. Credentials entered" : "2. Credentials entered"}
            description="Enter this studio's merchant API key and webhook salt from its own HitPay merchant dashboard."
            done={credentialsEntered}
          />
          <OnboardingStep
            title={isSuperAdmin ? "4. Enabled" : "3. Enabled"}
            description="Turn on HitPay for this studio only after the earlier steps are ready."
            done={enabled}
          />
        </div>
      </section>

      <form action={updateStudioHitpaySettings} className={`${ui.card} grid gap-4`}>
        <input type="hidden" name="studio_id" value={studio.id} />
        <div>
          <h2 className={ui.h2}>Sub-merchant setup</h2>
          <p className={`mt-2 text-sm ${ui.muted}`}>
            This studio still needs its own HitPay merchant account, merchant API key, and webhook salt.
          </p>
          <ul className={`mt-3 list-disc space-y-1 pl-5 text-sm ${ui.muted}`}>
            <li>Use the API key from your own HitPay merchant account.</li>
            <li>Your platform onboarding with HitPay must already be activated.</li>
          </ul>
        </div>
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
          <span className={ui.label}>Merchant API key</span>
          <input
            name="hitpay_api_key"
            type="password"
            defaultValue=""
            placeholder={hasApiKey ? "Configured (enter new key to rotate)" : "sub-merchant business api key"}
            className={ui.input}
          />
          <span className={`text-xs ${ui.muted}`}>
            Use the API key from your own HitPay merchant account.
          </span>
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
          <span className={`text-xs ${ui.muted}`}>This should match the webhook endpoint salt configured for this sub-merchant in HitPay.</span>
        </label>
        <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Saving...">
          Save settings
        </SubmitButton>
      </form>

      <section className={ui.card}>
        <h2 className={ui.h2}>Configuration status</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          Platform mode needs two layers: one shared platform key on the server, and one merchant key plus webhook salt
          for each studio acting as a sub-merchant.
        </p>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          Your platform onboarding with HitPay must already be activated before this studio setup can work.
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

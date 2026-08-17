import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ResendSettingsForm } from "@/components/dashboard/ResendSettingsForm";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { studioResendWebhookPath } from "@/lib/studio-email";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function DashboardEmailSettingsPage({ searchParams }: Props) {
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
  if (studioIds.length === 0) return <p className={ui.muted}>Only owners can update email settings.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, resend_enabled")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;
  const admin = createAdminClient();
  const { data: secrets } = await admin
    .from("studio_email_secrets")
    .select("resend_api_key, resend_from_email, resend_webhook_secret")
    .eq("studio_id", studio.id)
    .maybeSingle();
  const hasApiKey = Boolean(secrets?.resend_api_key?.trim());
  const fromEmail = secrets?.resend_from_email?.trim() || null;
  const hasWebhookSecret = Boolean(secrets?.resend_webhook_secret?.trim());
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://www.sgmystudio.com").replace(/\/$/, "");
  const webhookUrl = `${appUrl}${studioResendWebhookPath(studio.id)}`;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/settings" className={`${ui.btnSecondarySm} mb-3`}>
          ← Settings
        </DashboardAppLink>
        <h1 className={ui.h1}>Email settings</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Configure {studio.name}&apos;s independent Resend account for campaigns, appointment mail, and invoices.
        </p>
      </div>

      <ResendSettingsForm
        studioId={studio.id}
        webhookUrl={webhookUrl}
        initialEnabled={Boolean(studio.resend_enabled)}
        initialFromEmail={fromEmail}
        initialHasApiKey={hasApiKey}
        initialHasWebhookSecret={hasWebhookSecret}
      />

      <section className={ui.card}>
        <h2 className={ui.h2}>Configuration status</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          This studio can send mail when Resend is enabled and its API key, From address, and webhook secret are stored.
          Platform `RESEND_*` keys are not used as a fallback.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-stone-700 dark:text-stone-300">
          <li>`resend_enabled`: {studio.resend_enabled ? "enabled" : "disabled"}</li>
          <li>`resend_api_key`: {hasApiKey ? "configured" : "missing"}</li>
          <li>`resend_from_email`: {fromEmail ? "configured" : "missing"}</li>
          <li>`resend_webhook_secret`: {hasWebhookSecret ? "configured" : "missing"}</li>
        </ul>
      </section>
    </div>
  );
}

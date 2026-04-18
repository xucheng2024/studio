import { updateStudioPaynowSettings } from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { getPaynowSummary, validatePaynowConfig } from "@/lib/paynow";
import { bestRole } from "@/lib/rbac";
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
    .select(
      "id, name, paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name",
    )
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  const config = {
    paynow_enabled: Boolean(studio.paynow_enabled),
    paynow_proxy_type: studio.paynow_proxy_type ?? "uen",
    paynow_uen: studio.paynow_uen ?? null,
    paynow_mobile: studio.paynow_mobile ?? null,
    paynow_payee_name: studio.paynow_payee_name ?? null,
  };
  const status = validatePaynowConfig(config);
  const summary = getPaynowSummary(config);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Payment settings</h1>
        <p className={`mt-1 ${ui.muted}`}>Configure PayNow for {studio.name}.</p>
      </div>

      <form action={updateStudioPaynowSettings} className={`${ui.card} grid gap-4`}>
        <input type="hidden" name="studio_id" value={studio.id} />
        <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
          <input
            type="checkbox"
            name="paynow_enabled"
            defaultChecked={Boolean(studio.paynow_enabled)}
            className="h-4 w-4 rounded border-stone-300"
          />
          Enable PayNow
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Proxy type</span>
          <select
            name="paynow_proxy_type"
            defaultValue={studio.paynow_proxy_type ?? "uen"}
            className={ui.select}
          >
            <option value="uen">UEN</option>
            <option value="mobile">Mobile</option>
            <option value="uen_mobile">UEN + mobile</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>UEN</span>
          <input
            name="paynow_uen"
            defaultValue={studio.paynow_uen ?? ""}
            placeholder="201234567K"
            className={ui.input}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Mobile</span>
          <input
            name="paynow_mobile"
            defaultValue={studio.paynow_mobile ?? ""}
            placeholder="+6591234567"
            className={ui.input}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Payee name</span>
          <input
            name="paynow_payee_name"
            defaultValue={studio.paynow_payee_name ?? ""}
            placeholder="Studio Pte Ltd"
            className={ui.input}
          />
        </label>

        <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Saving...">
          Save settings
        </SubmitButton>
      </form>

      <section className={ui.card}>
        <h2 className={ui.h2}>Preview</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>{summary.line}</p>
        {!status.ok ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">Validation: {status.message}</p>
        ) : (
          <p className={`mt-2 text-sm ${ui.success}`}>Configuration is valid.</p>
        )}
      </section>
    </div>
  );
}

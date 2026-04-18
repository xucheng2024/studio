import { updateStudioContractSettings } from "@/app/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(
  path: string,
  selectedStudioId: string | null,
  selectedLocationId: string | null,
) {
  const p = new URLSearchParams();
  if (selectedStudioId) p.set("studio_id", selectedStudioId);
  if (selectedLocationId) p.set("location_id", selectedLocationId);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

export default async function DashboardSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const isSuperAdmin = isSuperAdminEmail(user.email);

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const role = bestRole(ctx);
  if (!["owner", "manager"].includes(role) && !isSuperAdmin) {
    return <p className={ui.muted}>You do not have settings access.</p>;
  }
  if (studioIds.length === 0 && !isSuperAdmin) return <p className={ui.muted}>Create a studio first.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }

  let contractStudio: {
    id: string;
    contract_status: string | null;
    contract_ends_at: string | null;
  } | null = null;
  if (selectedStudioId && role === "owner") {
    const { data } = await supabase
      .from("studios")
      .select("id, contract_status, contract_ends_at")
      .eq("id", selectedStudioId)
      .maybeSingle();
    contractStudio = data;
  }

  const endsLocal =
    contractStudio?.contract_ends_at && !Number.isNaN(new Date(contractStudio.contract_ends_at).getTime())
      ? new Date(contractStudio.contract_ends_at).toISOString().slice(0, 16)
      : "";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Settings</h1>
        <p className={ui.muted}>Studio-level configuration and admin tools.</p>
      </div>
      <div className={`${ui.card} grid gap-3 md:grid-cols-2`}>
        <DashboardAppLink href={scopedHref("/dashboard/overview", selectedStudioId, selectedLocationId)} className={ui.btnSecondary}>
          Studio profile
        </DashboardAppLink>
        <DashboardAppLink href={scopedHref("/dashboard/settings/payments", selectedStudioId, selectedLocationId)} className={ui.btnSecondary}>
          Payment settings
        </DashboardAppLink>
        {role === "owner" ? (
          <DashboardAppLink
            href={scopedHref("/dashboard/settings/staff-invites", selectedStudioId, selectedLocationId)}
            className={ui.btnSecondary}
          >
            Staff & roles
          </DashboardAppLink>
        ) : null}
        <DashboardAppLink href={scopedHref("/dashboard/qr", selectedStudioId, selectedLocationId)} className={ui.btnSecondary}>
          QR / share link
        </DashboardAppLink>
        {isSuperAdmin ? (
          <DashboardAppLink href="/dashboard/settings/owners" className={ui.btnSecondary}>
            Platform owner access
          </DashboardAppLink>
        ) : null}
      </div>
      {contractStudio ? (
        <form action={updateStudioContractSettings} className={`${ui.card} flex max-w-lg flex-col gap-3`}>
          <input type="hidden" name="studio_id" value={contractStudio.id} />
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Studio contract</h2>
            <p className={`mt-1 text-sm ${ui.muted}`}>
              Manual switch for B2B lifecycle. When set to suspended, day-to-day operations and booking APIs for this
              studio are blocked until you set it back to active.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Contract status</span>
            <select name="contract_status" defaultValue={contractStudio.contract_status ?? "active"} className={ui.select}>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Contract ends (optional)</span>
            <input
              name="contract_ends_at"
              type="datetime-local"
              defaultValue={endsLocal}
              className={ui.input}
            />
            <span className={`text-xs ${ui.muted}`}>Leave empty to clear. Stored in UTC.</span>
          </label>
          <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Saving...">
            Save contract
          </SubmitButton>
        </form>
      ) : null}
      {role !== "owner" ? (
        <p className={`text-sm ${ui.muted}`}>
          Manager view: owner-only settings may be visible as read-only depending on page rules.
        </p>
      ) : null}
    </div>
  );
}

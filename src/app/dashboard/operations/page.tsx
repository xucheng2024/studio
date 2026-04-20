import { CreditCard, UserCheck } from "lucide-react";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { OpsBoard } from "@/components/ops/OpsBoard";
import { OpsFilters } from "@/components/ops/OpsFilters";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    date_from?: string;
    date_to?: string;
    status?: string;
    q?: string;
  }>;
};

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function OperationsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0) {
    if (ctx.isSuperAdmin) {
      return (
        <div className="mx-auto w-full max-w-3xl">
          <div className={`${ui.card} flex flex-col gap-5`}>
            <div className="space-y-1">
              <p className={ui.badge}>Platform admin</p>
              <h1 className={ui.h1}>Grant owner access first</h1>
              <p className={ui.muted}>
                You are signed in as super admin. Create owner workspaces by granting owner access. Owners will then
                create and manage their own studios.
              </p>
            </div>
            <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-900/40">
              <p className="font-medium text-stone-900 dark:text-stone-100">Recommended flow</p>
              <p className={ui.muted}>1. Open Platform owner access</p>
              <p className={ui.muted}>2. Grant owner access by email</p>
              <p className={ui.muted}>3. Ask owner to sign in and create first studio</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <DashboardAppLink href="/dashboard/settings/owners" className={ui.btnPrimary}>
                Open owner access
              </DashboardAppLink>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className={`${ui.card} flex flex-col gap-5`}>
          <div className="space-y-1">
            <p className={ui.badge}>Setup required</p>
            <h1 className={ui.h1}>Create your first studio</h1>
            <p className={ui.muted}>
              Operations will be available after studio setup. Add your studio profile first, then return here to manage
              verification, check-ins, and exceptions.
            </p>
          </div>
          <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-900/40">
            <p className="font-medium text-stone-900 dark:text-stone-100">Next steps</p>
            <p className={ui.muted}>1. Open overview and create studio</p>
            <p className={ui.muted}>2. Add at least one location and class</p>
            <p className={ui.muted}>3. Return to Operations to process daily tasks</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DashboardAppLink href="/dashboard/overview" className={ui.btnPrimary}>
              Create studio now
            </DashboardAppLink>
            <DashboardAppLink href="/booking" className={ui.btnSecondarySm}>
              Open public booking page
            </DashboardAppLink>
          </div>
        </div>
      </div>
    );
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return (
      <div className={`${ui.card} max-w-2xl`}>
        <p className="font-medium text-stone-900 dark:text-stone-100">Choose a studio to continue</p>
        <p className={`mt-1 ${ui.muted}`}>
          You have access to multiple studios. Use the studio switcher on the left, then Operations will load the
          matching queue.
        </p>
      </div>
    );
  }
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const { data: studios } = await supabase
    .from("studios")
    .select("id, name")
    .in("id", studioIds)
    .order("name");

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const { data: opContract } = await supabase
    .from("studios")
    .select("contract_status")
    .eq("id", activeStudioId)
    .maybeSingle();
  const studioSuspended = opContract?.contract_status === "suspended";
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");
  const filterParams = new URLSearchParams();
  filterParams.set("studio_id", activeStudioId);
  if (selectedLocationId) filterParams.set("location_id", selectedLocationId);
  if (sp.date_from) filterParams.set("date_from", sp.date_from);
  if (sp.date_to) filterParams.set("date_to", sp.date_to);
  if (sp.status) filterParams.set("status", sp.status);
  if (sp.q) filterParams.set("q", sp.q);

  return (
    <div className="flex flex-col gap-4">
      {studioSuspended ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
          role="status"
        >
          <p className="font-medium">Studio contract suspended</p>
          <p className={`mt-1 ${ui.muted}`}>
            Operations APIs and mutating actions are paused for this studio. Owners can resume under Settings → Studio
            contract.
          </p>
        </div>
      ) : null}
      <div>
        <h1 className={ui.h1}>Today&apos;s front desk</h1>
        <p className={ui.muted}>One queue for payment checks, arrivals, and urgent follow-ups.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <DashboardAppLink href={`/dashboard/payments?${filterParams.toString()}`} className={ui.btnSecondarySm}>
            <CreditCard size={13} />
            Payment records
          </DashboardAppLink>
          <DashboardAppLink href={`/dashboard/frontdesk?${filterParams.toString()}`} className={ui.btnSecondarySm}>
            <UserCheck size={13} />
            Walk-in & check-in
          </DashboardAppLink>
        </div>
      </div>
      <OpsFilters
        studios={(studios ?? []).map((s) => ({ id: s.id, name: s.name }))}
        locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name, studio_id: l.studio_id }))}
        selectedStudioId={activeStudioId}
        selectedLocationId={selectedLocationId}
        dateFrom={sp.date_from ?? todayISODate()}
        dateTo={sp.date_to ?? todayISODate()}
        status={sp.status ?? ""}
        query={sp.q ?? ""}
      />
      <OpsBoard
        studioId={activeStudioId}
        locationId={selectedLocationId}
        dateFrom={sp.date_from ?? todayISODate()}
        dateTo={sp.date_to ?? todayISODate()}
        status={sp.status ?? ""}
        q={sp.q ?? ""}
      />
    </div>
  );
}

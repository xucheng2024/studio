import Link from "next/link";
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
    recon_status?: string;
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
            <Link href="/dashboard/overview" className={ui.btnPrimary}>
              Create studio now
            </Link>
            <Link href="/booking" className={ui.btnSecondarySm}>
              Open public booking page
            </Link>
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
    return <p className={ui.muted}>You do not have operations access.</p>;
  }

  const { data: studios } = await supabase
    .from("studios")
    .select("id, name")
    .in("id", studioIds)
    .order("name");

  const activeStudioId = selectedStudioId ?? studioIds[0];
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
  if (sp.recon_status) filterParams.set("recon_status", sp.recon_status);
  if (sp.q) filterParams.set("q", sp.q);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className={ui.h1}>Operations hub</h1>
        <p className={ui.muted}>One queue for payment verification, check-in, exceptions, and manual actions.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={`/dashboard/payments?view=recon&${filterParams.toString()}`} className={ui.btnSecondarySm}>
            Open full reconciliation
          </Link>
          <Link href={`/dashboard/schedule?${filterParams.toString()}`} className={ui.btnSecondarySm}>
            Open session view
          </Link>
          <Link href={`/dashboard/clients?${filterParams.toString()}`} className={ui.btnSecondarySm}>
            Open member view
          </Link>
          <Link href={`/dashboard/frontdesk?${filterParams.toString()}`} className={ui.btnSecondarySm}>
            Frontdesk tools
          </Link>
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
        reconStatus={sp.recon_status ?? ""}
        query={sp.q ?? ""}
      />
      <OpsBoard
        studioId={activeStudioId}
        locationId={selectedLocationId}
        dateFrom={sp.date_from ?? todayISODate()}
        dateTo={sp.date_to ?? todayISODate()}
        status={sp.status ?? ""}
        reconStatus={sp.recon_status ?? ""}
        q={sp.q ?? ""}
      />
    </div>
  );
}

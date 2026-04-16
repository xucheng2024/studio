import { OpsBoard } from "@/components/ops/OpsBoard";
import { OpsFilters } from "@/components/ops/OpsFilters";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string; date?: string; q?: string }>;
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
    return <p className={ui.muted}>Create a studio from the overview first.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className={ui.h1}>Operations hub</h1>
        <p className={ui.muted}>One queue for payment verification, check-in, exceptions, and manual actions.</p>
      </div>
      <OpsFilters
        studios={(studios ?? []).map((s) => ({ id: s.id, name: s.name }))}
        locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name, studio_id: l.studio_id }))}
        selectedStudioId={activeStudioId}
        selectedLocationId={selectedLocationId}
        date={sp.date ?? todayISODate()}
        query={sp.q ?? ""}
      />
      <OpsBoard
        studioId={activeStudioId}
        locationId={selectedLocationId}
        date={sp.date ?? todayISODate()}
        q={sp.q ?? ""}
      />
    </div>
  );
}

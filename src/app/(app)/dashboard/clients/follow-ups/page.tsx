import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { LocalDate } from "@/components/ui/LocalDate";
import { LocalTime } from "@/components/ui/LocalTime";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { upsertTreatmentFollowUpAction } from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { listTreatmentFollowUpQueue, type TreatmentFollowUpStatus } from "@/lib/salon-treatments";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    status?: string;
    due_before?: string;
  }>;
};

const STATUS_OPTIONS: Array<TreatmentFollowUpStatus | "all"> = ["all", "pending", "in_progress", "done", "cancelled"];

export default async function FollowUpQueuePage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email ?? null,
      studioId: sp.studio_id ?? null,
      locationId: sp.location_id ?? null,
    },
    ["owner", "manager", "frontdesk", "instructor"],
  );

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);

  const admin = createAdminClient();
  const [{ data: locations }, { data: employees }] = await Promise.all([
    admin
      .from("locations")
      .select("id, name, studio_id")
      .eq("studio_id", activeStudioId)
      .eq("is_active", true)
      .order("name"),
    admin
      .from("employees")
      .select("id, display_name, employee_locations!inner(location_id, studio_id, is_active)")
      .eq("studio_id", activeStudioId)
      .eq("employment_status", "active")
      .order("display_name"),
  ]);

  const status = STATUS_OPTIONS.includes((sp.status ?? "all") as TreatmentFollowUpStatus | "all")
    ? (sp.status ?? "all") as TreatmentFollowUpStatus | "all"
    : "all";

  const queueResult = await listTreatmentFollowUpQueue({
    userId: user.id,
    email: user.email ?? null,
    studioId: activeStudioId,
    locationId: selectedLocationId ?? null,
    status,
    dueOnOrBefore: sp.due_before ?? null,
  });

  const locationEmployees = (employees ?? []).filter((row) => {
    if (!selectedLocationId) return true;
    const scopes = Array.isArray(row.employee_locations) ? row.employee_locations : [row.employee_locations];
    return scopes.some((scope) => scope?.location_id === selectedLocationId && scope?.is_active);
  }) as Array<{ id: string; display_name: string }>;

  const scopeParams = new URLSearchParams();
  scopeParams.set("studio_id", activeStudioId);
  if (selectedLocationId) scopeParams.set("location_id", selectedLocationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <DashboardAppLink href={`/dashboard/clients?${scopeParams.toString()}`} className={`${ui.btnSecondarySm} mb-3`}>
          ← Customers
        </DashboardAppLink>
        <h1 className={ui.h1}>Follow-up queue</h1>
        <p className={`mt-1 ${ui.muted}`}>Due-date sorted CRM-02 follow-ups within your role/location scope.</p>
      </div>

      <div className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={locations ?? []}
          selectedStudioId={activeStudioId}
          selectedLocationId={selectedLocationId}
          allowAll={canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
        />
      </div>

      <form method="get" className={`${ui.card} grid gap-3 sm:grid-cols-3`}>
        <input type="hidden" name="studio_id" value={activeStudioId} />
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Status</span>
          <select name="status" className={ui.select} defaultValue={status}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Due on or before</span>
          <input name="due_before" type="date" className={ui.input} defaultValue={sp.due_before ?? ""} />
        </label>

        <div className="flex items-end gap-2">
          <button type="submit" className={ui.btnPrimarySm}>Apply</button>
          <DashboardAppLink href={`/dashboard/clients/follow-ups?${scopeParams.toString()}`} className={ui.btnGhost}>Reset</DashboardAppLink>
        </div>
      </form>

      {!queueResult.ok ? (
        <div className={`${ui.card}`}>
          <p className={ui.muted}>No CRM-02 queue access in this scope.</p>
        </div>
      ) : queueResult.rows.length === 0 ? (
        <div className={`${ui.card}`}>
          <p className={ui.muted}>No follow-ups found for current filters.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {queueResult.rows.map((row) => {
            const overdue = row.status !== "done" && row.status !== "cancelled" && row.due_on < new Date().toISOString().slice(0, 10);
            return (
              <li key={row.id} className={`${ui.card} border ${overdue ? "border-amber-300 dark:border-amber-800" : "border-stone-200 dark:border-stone-800"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{row.treatment.service_title_snapshot}</p>
                    <p className={`mt-0.5 text-xs ${ui.muted}`}>
                      treatment: {row.treatment.id.slice(0, 8)} · appointment: {row.treatment.appointment_id.slice(0, 8)}
                    </p>
                  </div>
                  <DashboardAppLink
                    href={`/dashboard/clients/${row.salon_customer_id}?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
                    className={ui.btnGhost}
                  >
                    Open customer
                  </DashboardAppLink>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                  <span>due <LocalDate iso={`${row.due_on}T00:00:00+08:00`} /></span>
                  <span>owner {row.owner_name_snapshot ?? "Unassigned"}</span>
                  <span>status {row.status}</span>
                  {row.completed_at ? <span>completed <LocalTime iso={row.completed_at} /></span> : null}
                  {overdue ? <span className="text-amber-700 dark:text-amber-300">overdue</span> : null}
                </div>

                <ServerActionToastForm action={upsertTreatmentFollowUpAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="studio_id" value={activeStudioId} />
                  <input type="hidden" name="customer_id" value={row.salon_customer_id} />
                  <input type="hidden" name="treatment_id" value={row.treatment_id} />
                  <input type="hidden" name="follow_up_id" value={row.id} />
                  <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Due date</span><input name="due_on" type="date" defaultValue={row.due_on} className={ui.input} /></label>
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Status</span><select name="status" className={ui.select} defaultValue={row.status}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Owner</span><select name="owner_employee_id" className={ui.select} defaultValue={row.owner_employee_id ?? ""}><option value="">Unassigned</option>{locationEmployees.map((employee) => (<option key={employee.id} value={employee.id}>{employee.display_name}</option>))}</select></label>
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Note (non-sensitive)</span><input name="note_summary" className={ui.input} defaultValue={row.note_summary ?? ""} /></label>
                  <div className="sm:col-span-2"><button type="submit" className={ui.btnPrimarySm}>Save follow-up</button></div>
                </ServerActionToastForm>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

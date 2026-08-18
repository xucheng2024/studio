import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { sanitizeEventExternalBookingUrl } from "@/lib/eventBookingUrl";
import { OpsDesk } from "@/components/ops/OpsDesk";
import { localISODate } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { ClipboardList } from "lucide-react";

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    date_from?: string;
    date_to?: string;
    session_status?: "all" | "scheduled" | "cancelled";
  }>;
};

type Pkg02OpsCheckRunRow = {
  id: string;
  checked_at: string;
  backlog_threshold_hours: number;
  has_anomaly: boolean;
  self_approval_or_apply_count: number;
  approved_not_applied_backlog_count: number;
  applied_missing_manual_adjustment_ledger_count: number;
  manual_adjustment_reconcile_diff_count: number;
  notify_status: "sent" | "skipped" | "failed";
  notify_reason: string | null;
};

export default async function OperationsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  }, ["owner", "manager", "frontdesk"]);
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
              Front desk will be available after studio setup. Add your studio profile first, then return here
              to manage walk-ins, verification, check-ins, and exceptions.
            </p>
          </div>
          <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-900/40">
            <p className="font-medium text-stone-900 dark:text-stone-100">Next steps</p>
            <p className={ui.muted}>1. Open overview and create studio</p>
            <p className={ui.muted}>2. Add at least one location and class</p>
            <p className={ui.muted}>3. Return to Front desk to process daily tasks</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DashboardAppLink href="/dashboard/overview" className={ui.btnPrimary}>
              Create studio now
            </DashboardAppLink>
            <DashboardAppLink href="/" className={ui.btnSecondarySm}>
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
          You have access to multiple studios. Use the studio switcher on the left, then Front desk will load the
          matching queue.
        </p>
      </div>
    );
  }
  const activeStudioId = selectedStudioId ?? studioIds[0];
  const admin = createAdminClient();
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .order("name");
  const { data: opContract } = await supabase
    .from("studios")
    .select("contract_status")
    .eq("id", activeStudioId)
    .maybeSingle();
  const studioSuspended = opContract?.contract_status === "suspended";
  const defaultDate = localISODate();
  const dateFrom = sp.date_from ?? defaultDate;
  const dateTo = sp.date_to ?? defaultDate;
  const sessionStatus = sp.session_status ?? "all";
  const dayStartIso = `${defaultDate}T00:00:00+08:00`;
  const nextDate = new Date(`${defaultDate}T00:00:00+08:00`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const dayEndIso = nextDate.toISOString();
  let walkinSessionsQuery = supabase
    .from("class_sessions")
    .select("id, start_time, spots_left, guest_price, class_title_snapshot, classes!inner(title, studio_id)")
    .eq("classes.studio_id", activeStudioId)
    .eq("status", "scheduled")
    .gte("start_time", dayStartIso)
    .lt("start_time", dayEndIso)
    .gt("spots_left", 0)
    .order("start_time", { ascending: true });
  if (selectedLocationId) walkinSessionsQuery = walkinSessionsQuery.eq("location_id", selectedLocationId);
  const { data: walkinSessionsRaw } = await walkinSessionsQuery;
  const walkinSessions = (walkinSessionsRaw ?? []).map((session) => {
    const cls = Array.isArray(session.classes) ? session.classes[0] : session.classes;
    const title = (session as { class_title_snapshot?: string | null }).class_title_snapshot ?? cls?.title ?? "Class";
    return {
      id: session.id,
      startTime: String(session.start_time ?? ""),
      title,
      spotsLeft: session.spots_left ?? 0,
      guestPrice: Number(session.guest_price ?? 0),
    };
  });

  let walkinEventsQuery = supabase
    .from("events")
    .select("id, start_time, spots_left, price, title, external_booking_url")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .gte("start_time", dayStartIso)
    .lt("start_time", dayEndIso)
    .gt("spots_left", 0)
    .order("start_time", { ascending: true });
  if (selectedLocationId) walkinEventsQuery = walkinEventsQuery.eq("location_id", selectedLocationId);
  const { data: walkinEventsRaw } = await walkinEventsQuery;
  const walkinEvents = (walkinEventsRaw ?? [])
    .filter((event) => !sanitizeEventExternalBookingUrl(event.external_booking_url))
    .map((event) => ({
      id: event.id,
      startTime: String(event.start_time ?? ""),
      title: event.title ?? "Event",
      spotsLeft: event.spots_left ?? 0,
      guestPrice: Number(event.price ?? 0),
    }));

  const { data: walkinServicesRaw } = await supabase
    .from("studio_services")
    .select("id, title, price")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .not("price", "is", null)
    .order("sort_order", { ascending: true });
  const walkinServices = (walkinServicesRaw ?? []).map((service) => ({
    id: service.id,
    title: service.title ?? "Service",
    guestPrice: Number(service.price ?? 0),
  }));
  const { data: walkinCustomersRaw } = await admin
    .from("salon_customers")
    .select("id, full_name, phone, email")
    .eq("studio_id", activeStudioId)
    .eq("status", "active")
    .is("merged_into_id", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  const walkinCustomers = (walkinCustomersRaw ?? []).map((customer) => ({
    id: customer.id,
    full_name: customer.full_name ?? "Unnamed",
    phone: customer.phone ?? null,
    email: customer.email ?? null,
  }));

  let opsCheckRunsQuery = admin
    .from("pkg02_ops_check_runs")
    .select(
      "id, checked_at, backlog_threshold_hours, has_anomaly, self_approval_or_apply_count, approved_not_applied_backlog_count, applied_missing_manual_adjustment_ledger_count, manual_adjustment_reconcile_diff_count, notify_status, notify_reason",
    )
    .eq("studio_id", activeStudioId)
    .order("checked_at", { ascending: false })
    .limit(8);

  if (selectedLocationId) {
    opsCheckRunsQuery = opsCheckRunsQuery.or(`location_id.eq.${selectedLocationId},location_id.is.null`);
  }

  const { data: opsCheckRunsRaw } = await opsCheckRunsQuery;
  const opsCheckRuns = (opsCheckRunsRaw ?? []) as Pkg02OpsCheckRunRow[];
  const latestOpsRun = opsCheckRuns[0] ?? null;
  const anomalyRunsCount = opsCheckRuns.filter((row) => row.has_anomaly).length;
  const notifySentRunsCount = opsCheckRuns.filter((row) => row.notify_status === "sent").length;
  const notifySkippedRunsCount = opsCheckRuns.filter((row) => row.notify_status === "skipped").length;
  const notifyFailedRunsCount = opsCheckRuns.filter((row) => row.notify_status === "failed").length;
  const latestCheckedAtLabel = latestOpsRun
    ? new Date(latestOpsRun.checked_at).toLocaleString("en-SG", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {studioSuspended ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
          role="status"
        >
          <p className="font-medium">Studio contract suspended</p>
          <p className={`mt-1 ${ui.muted}`}>
            Booking APIs and mutating actions are paused for this studio. Owners can resume under Settings → Studio
            contract.
          </p>
        </div>
      ) : null}
      <div>
        <h1 className={ui.h1}>Front desk</h1>
        <p className={ui.muted}>Daily front desk sales, booking, attendance, and exception handling for classes, events, and services.</p>
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
      <form method="get" className={`${ui.card} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
        <input type="hidden" name="studio_id" value={activeStudioId} />
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Booking status</span>
          <select name="session_status" className={ui.select} defaultValue={sessionStatus}>
            <option value="all">All</option>
            <option value="scheduled">Scheduled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>From date</span>
          <input type="date" name="date_from" className={ui.input} defaultValue={dateFrom} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>To date</span>
          <input type="date" name="date_to" className={ui.input} defaultValue={dateTo} />
        </label>
        <div className={`${ui.mobileActionBar} flex flex-col items-stretch gap-2 sm:col-span-2 sm:flex-row sm:items-end lg:col-span-4`}>
          <button type="submit" className={ui.btnPrimarySm}>Apply</button>
          <DashboardAppLink
            href={`/dashboard/operations?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
            className={ui.btnGhost}
          >
            Reset
          </DashboardAppLink>
        </div>
      </form>
      <OpsDesk
        studioId={activeStudioId}
        locationId={selectedLocationId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        sessionStatus={sessionStatus}
        sessions={walkinSessions}
        events={walkinEvents}
        services={walkinServices}
        customers={walkinCustomers}
        disabled={studioSuspended}
      >
        <section className={`${ui.card} flex flex-col gap-3`}>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-300">
              <ClipboardList size={17} />
            </span>
            <div>
              <h2 className={ui.h2}>Front desk notes</h2>
              <p className={ui.muted}>Quick guide for ad-hoc arrivals and payment capture.</p>
            </div>
          </div>
          <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-900/40">
            <p className="font-medium text-stone-900 dark:text-stone-100">What this does</p>
            <p className={ui.muted}>Creates a booked guest or service order, records the payment immediately, and optionally checks class or event guests in on the same step.</p>
          </div>
          <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-900/40">
            <p className="font-medium text-stone-900 dark:text-stone-100">Today&apos;s availability</p>
            <p className={ui.muted}>
              {walkinSessions.length > 0 || walkinEvents.length > 0 || walkinServices.length > 0
                ? `${walkinSessions.length} session${walkinSessions.length === 1 ? "" : "s"}, ${walkinEvents.length} event${walkinEvents.length === 1 ? "" : "s"}, and ${walkinServices.length} service${walkinServices.length === 1 ? "" : "s"} are available for front desk sales.`
                : "No scheduled sessions, events, or priced services are available right now."}
            </p>
          </div>
        </section>
      </OpsDesk>
      <section className={ui.card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={ui.h2}>Package adjustment checks</h2>
            <p className={ui.muted}>Automatic checks for class-pass changes that still need a second person.</p>
          </div>
          <DashboardAppLink
            href={`/dashboard/packages/approvals?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}&backlog_only=1`}
            className={ui.btnSecondarySm}
          >
            Open waiting adjustments
          </DashboardAppLink>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <p className={`text-xs ${ui.muted}`}>Last checked</p>
            <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{latestCheckedAtLabel ?? "No run yet"}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <p className={`text-xs ${ui.muted}`}>Waiting too long</p>
            <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">
              {latestOpsRun ? `${latestOpsRun.approved_not_applied_backlog_count} (≥${latestOpsRun.backlog_threshold_hours}h)` : "-"}
            </p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <p className={`text-xs ${ui.muted}`}>Checks with issues (last {opsCheckRuns.length || 0})</p>
            <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">
              {opsCheckRuns.length ? `${anomalyRunsCount}/${opsCheckRuns.length}` : "-"}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <p className={`text-xs ${ui.muted}`}>Alerts sent (last {opsCheckRuns.length || 0})</p>
            <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{opsCheckRuns.length ? notifySentRunsCount : "-"}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <p className={`text-xs ${ui.muted}`}>Alerts skipped</p>
            <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{opsCheckRuns.length ? notifySkippedRunsCount : "-"}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <p className={`text-xs ${ui.muted}`}>Alerts failed</p>
            <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{opsCheckRuns.length ? notifyFailedRunsCount : "-"}</p>
          </div>
        </div>
        {opsCheckRuns.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                  <th className="py-2 pr-4 font-medium">Checked</th>
                  <th className="py-2 pr-4 font-medium">Same-person action</th>
                  <th className="py-2 pr-4 font-medium">Waiting to apply</th>
                  <th className="py-2 pr-4 font-medium">Missing credit record</th>
                  <th className="py-2 pr-4 font-medium">Credit mismatch</th>
                  <th className="py-2 pr-4 font-medium">Alert</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {opsCheckRuns.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 last:border-b-0 dark:border-stone-800">
                    <td className="py-2.5 pr-4 text-stone-700 dark:text-stone-300">
                      {new Date(row.checked_at).toLocaleString("en-SG", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums text-stone-700 dark:text-stone-300">{row.self_approval_or_apply_count}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-stone-700 dark:text-stone-300">
                      {row.approved_not_applied_backlog_count} (≥{row.backlog_threshold_hours}h)
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums text-stone-700 dark:text-stone-300">{row.applied_missing_manual_adjustment_ledger_count}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-stone-700 dark:text-stone-300">{row.manual_adjustment_reconcile_diff_count}</td>
                    <td className="py-2.5 pr-4 text-stone-700 dark:text-stone-300">{row.notify_status}</td>
                    <td className="py-2.5">
                      {row.has_anomaly ? (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300">
                          Needs review
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/50 dark:text-teal-300">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <DashboardAppLink
                        href={`/dashboard/operations/pkg02-checks/${row.id}?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
                        className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                      >
                        View details
                      </DashboardAppLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`mt-3 text-sm ${ui.muted}`}>No checks yet. These run automatically in the background.</p>
        )}
      </section>
    </div>
  );
}

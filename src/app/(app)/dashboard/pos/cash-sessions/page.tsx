import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { openPosCashSessionAction } from "@/app/(app)/dashboard/actions";
import { formatLocalDateTime } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

const STATUS_OPTIONS = ["all", "open", "closed", "voided"] as const;

type CashSessionStatusFilter = (typeof STATUS_OPTIONS)[number];

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    status?: CashSessionStatusFilter;
  }>;
};

type CashSessionRow = {
  id: string;
  studio_id: string;
  location_id: string;
  opened_by: string | null;
  opened_at: string;
  opening_float: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  cash_over_short: number | null;
  status: "open" | "closed" | "voided";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function statusBadgeClass(status: string) {
  if (status === "open") return ui.badgeAmber;
  if (status === "closed") return ui.badge;
  if (status === "voided") return ui.badgeRed;
  return ui.badgeNeutral;
}

function money(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

export default async function PosCashSessionsPage({ searchParams }: Props) {
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
    ["owner", "manager", "frontdesk"],
  );

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to cash sessions.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the sidebar to continue.</p>;
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

  const normalizedLocations = locations ?? [];
  const effectiveLocationId =
    selectedLocationId && normalizedLocations.some((location) => location.id === selectedLocationId)
      ? selectedLocationId
      : null;

  const selectedStatus = STATUS_OPTIONS.includes((sp.status ?? "all") as CashSessionStatusFilter)
    ? (sp.status ?? "all")
    : "all";

  let sessionQuery = admin
    .from("pos_cash_sessions")
    .select("id, studio_id, location_id, opened_by, opened_at, opening_float, cash_in, cash_out, expected_cash, closed_by, closed_at, counted_cash, cash_over_short, status, notes, created_at, updated_at")
    .eq("studio_id", activeStudioId)
    .order("opened_at", { ascending: false })
    .limit(120);

  if (effectiveLocationId) sessionQuery = sessionQuery.eq("location_id", effectiveLocationId);
  if (selectedStatus !== "all") sessionQuery = sessionQuery.eq("status", selectedStatus);

  const { data: sessionRowsRaw, error: sessionsError } = await sessionQuery;
  if (sessionsError) {
    return <p className={ui.error}>Could not load cash sessions: {sessionsError.message}</p>;
  }

  const sessions = (sessionRowsRaw ?? []) as CashSessionRow[];
  const locationNameById = new Map(normalizedLocations.map((location) => [location.id, location.name ?? "Unnamed location"]));

  const userIds = [...new Set(
    sessions
      .flatMap((session) => [session.opened_by, session.closed_by])
      .filter((value): value is string => Boolean(value)),
  )];

  const { data: usersRaw } =
    userIds.length > 0
      ? await admin
          .from("users")
          .select("id, email")
          .in("id", userIds)
      : { data: [] as const };
  const userEmailById = new Map((usersRaw ?? []).map((row) => [row.id, row.email ?? row.id]));

  const openCount = sessions.filter((session) => session.status === "open").length;
  const closedCount = sessions.filter((session) => session.status === "closed").length;

  const locationOptions = canViewAllLocations
    ? normalizedLocations
    : normalizedLocations.filter((location) => accessibleLocationIds.includes(location.id));

  const defaultOpenLocationId =
    (effectiveLocationId && locationOptions.some((location) => location.id === effectiveLocationId)
      ? effectiveLocationId
      : locationOptions[0]?.id) ?? "";

  const scopeQuery = new URLSearchParams();
  scopeQuery.set("studio_id", activeStudioId);
  if (effectiveLocationId) scopeQuery.set("location_id", effectiveLocationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={ui.h1}>Cash sessions</h1>
        <DashboardAppLink href={`/dashboard/pos?${scopeQuery.toString()}`} className={ui.btnSecondarySm}>
          Back to POS sales
        </DashboardAppLink>
      </div>

      <section className={`${ui.card} flex flex-wrap items-end gap-3`}>
        <DashboardLocationFilter
          locations={normalizedLocations}
          selectedStudioId={activeStudioId}
          selectedLocationId={effectiveLocationId}
          allowAll={canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
        />

        <form className="flex min-w-44 flex-col gap-1.5" method="get">
          <input type="hidden" name="studio_id" value={activeStudioId} />
          {effectiveLocationId ? <input type="hidden" name="location_id" value={effectiveLocationId} /> : null}
          <label className={ui.label} htmlFor="cash-session-status">Status</label>
          <select id="cash-session-status" name="status" className={ui.select} defaultValue={selectedStatus}>
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="voided">Voided</option>
          </select>
          <button type="submit" className={ui.btnSecondarySm}>Apply</button>
        </form>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Open a cash session</h2>
        {locationOptions.length === 0 ? (
          <p className={`mt-2 text-sm ${ui.muted}`}>No location available in your current scope.</p>
        ) : (
          <ServerActionToastForm action={openPosCashSessionAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="studio_id" value={activeStudioId} />
            <input
              type="hidden"
              name="idempotency_key"
              value={`pos-cash-session-open:${activeStudioId}:${defaultOpenLocationId}:${Date.now()}`}
            />
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Location</span>
              <select name="location_id" className={ui.select} defaultValue={defaultOpenLocationId} required>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>{location.name ?? location.id}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Opening float (SGD)</span>
              <input name="opening_float" type="number" step="0.01" min="0" className={ui.input} defaultValue="0.00" />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1.5">
              <span className={ui.label}>Notes</span>
              <input name="notes" className={ui.input} placeholder="Optional handover/opening notes" />
            </label>
            <div className="md:col-span-2">
              <button type="submit" className={ui.btnPrimary}>Open cash session</button>
            </div>
          </ServerActionToastForm>
        )}
      </section>

      <section className={ui.card}>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <p className={ui.muted}>Sessions (current filter)</p>
            <p className="text-xl font-semibold text-stone-900 dark:text-stone-100">{sessions.length}</p>
          </div>
          <div>
            <p className={ui.muted}>Open</p>
            <p className="text-xl font-semibold text-amber-700 dark:text-amber-300">{openCount}</p>
          </div>
          <div>
            <p className={ui.muted}>Closed</p>
            <p className="text-xl font-semibold text-teal-700 dark:text-teal-300">{closedCount}</p>
          </div>
        </div>
      </section>

      {sessions.length === 0 ? (
        <section className={ui.card}>
          <p className={ui.muted}>No cash sessions found for current filter.</p>
        </section>
      ) : (
        <section className={`${ui.card} overflow-x-auto`}>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left dark:border-stone-700">
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2">Opened by</th>
                <th className="px-3 py-2">Expected</th>
                <th className="px-3 py-2">Counted</th>
                <th className="px-3 py-2">Over/short</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const detailQuery = new URLSearchParams();
                detailQuery.set("studio_id", activeStudioId);
                detailQuery.set("location_id", session.location_id);

                return (
                  <tr key={session.id} className="border-b border-stone-100 align-top last:border-0 dark:border-stone-800">
                    <td className="px-3 py-2">
                      <span className={`${statusBadgeClass(session.status)} capitalize`}>{session.status}</span>
                    </td>
                    <td className="px-3 py-2">{locationNameById.get(session.location_id) ?? session.location_id}</td>
                    <td className="px-3 py-2">{formatLocalDateTime(session.opened_at)}</td>
                    <td className="px-3 py-2">{session.opened_by ? (userEmailById.get(session.opened_by) ?? session.opened_by) : "-"}</td>
                    <td className="px-3 py-2">SGD {money(session.expected_cash)}</td>
                    <td className="px-3 py-2">{session.counted_cash == null ? "-" : `SGD ${money(session.counted_cash)}`}</td>
                    <td className="px-3 py-2">{session.cash_over_short == null ? "-" : `SGD ${money(session.cash_over_short)}`}</td>
                    <td className="px-3 py-2">
                      <DashboardAppLink
                        href={`/dashboard/pos/cash-sessions/${session.id}?${detailQuery.toString()}`}
                        className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                      >
                        View detail
                      </DashboardAppLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

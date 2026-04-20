import { getDashboardScope } from "@/lib/dashboard";
import AdvancedDetails from "./advanced-details";
import {
  computeRevenueSummary,
  revenueByClassTitle,
  revenueByDay,
  revenueByLocationLabel,
  type RevenuePaymentRow,
} from "@/lib/revenue-summary";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { TrendingUp, RefreshCcw, DollarSign } from "lucide-react";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    date_from?: string;
    date_to?: string;
    class_sort?: string;
    class_top_n?: string;
  }>;
};

function dayRangeStart(d?: string) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function dayRangeEnd(d?: string) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

type PaymentWithBooking = RevenuePaymentRow & {
  booking_id?: string | null;
  payment_method?: string | null;
  bookings?: {
    class_sessions?: {
      classes?: { title?: string | null } | { title?: string | null }[] | null;
    } | null;
  } | {
    class_sessions?: {
      classes?: { title?: string | null } | { title?: string | null }[] | null;
    } | null;
  }[] | null;
};

function classTitleFromPayment(p: PaymentWithBooking): string | null {
  const b = p.bookings;
  if (!b) return null;
  const book = Array.isArray(b) ? b[0] : b;
  const cs = book?.class_sessions;
  if (!cs) return null;
  const sess = Array.isArray(cs) ? cs[0] : cs;
  const cl = sess?.classes;
  const c = Array.isArray(cl) ? cl[0] : cl;
  return c?.title ?? null;
}

export default async function ReportsPage({ searchParams }: Props) {
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
    return <p className={ui.muted}>Create your first studio in Overview.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  if (!["owner", "manager"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const bounds = monthBounds();
  const dateFrom = sp.date_from ?? bounds.from;
  const dateTo = sp.date_to ?? bounds.to;
  const classSort = sp.class_sort === "rate" ? "rate" : sp.class_sort === "booked" ? "booked" : "attended";
  const classTopN = Number(sp.class_top_n ?? 20);
  const classTopNSafe = Number.isFinite(classTopN) && classTopN > 0 ? Math.min(Math.floor(classTopN), 200) : 20;
  const fromIso = dayRangeStart(dateFrom);
  const toIso = dayRangeEnd(dateTo);

  let revenueQuery = supabase
    .from("payments")
    .select(
      `
      id,
      amount,
      type,
      payment_method,
      status,
      created_at,
      location_id,
      booking_id,
      bookings (
        class_sessions (
          classes ( title )
        )
      )
    `,
    )
    .in("studio_id", studioIds)
    .in("status", ["paid", "refunded"])
    .order("created_at", { ascending: false })
    .limit(5000);
  if (selectedLocationId) revenueQuery = revenueQuery.eq("location_id", selectedLocationId);
  if (fromIso) revenueQuery = revenueQuery.gte("created_at", fromIso);
  if (toIso) revenueQuery = revenueQuery.lt("created_at", toIso);
  const { data: revenuePaymentsRaw } = await revenueQuery;

  const revenuePayments = (revenuePaymentsRaw ?? []) as PaymentWithBooking[];
  const summary = computeRevenueSummary(revenuePayments);
  const byDay = revenueByDay(revenuePayments);

  const { data: locRows } = await supabase.from("locations").select("id, name").in("studio_id", studioIds);
  const locNames = new Map((locRows ?? []).map((l) => [l.id, l.name ?? ""]));
  const byLocation = revenueByLocationLabel(revenuePayments, locNames);

  const withClassTitles = revenuePayments.map((p) => ({
    ...p,
    classTitle: classTitleFromPayment(p),
  }));
  const byClass = revenueByClassTitle(withClassTitles);

  let classQuery = supabase
    .from("classes")
    .select(
      `
      id,
      title,
      location_id,
      instructor_id,
      locations ( name ),
      instructors ( name )
    `,
    )
    .in("studio_id", studioIds)
    .limit(400);
  if (selectedLocationId) classQuery = classQuery.eq("location_id", selectedLocationId);
  const { data: classRows } = await classQuery;
  const classIds = (classRows ?? []).map((c) => c.id);
  const classMeta = new Map<
    string,
    { title: string; locationName: string; instructorName: string; locationId: string | null }
  >();
  for (const c of classRows ?? []) {
    const location = Array.isArray(c.locations) ? c.locations[0] : c.locations;
    const instructor = Array.isArray(c.instructors) ? c.instructors[0] : c.instructors;
    classMeta.set(c.id, {
      title: c.title ?? "Class",
      locationName: location?.name ?? "Unassigned location",
      instructorName: instructor?.name ?? "Unassigned instructor",
      locationId: c.location_id ?? null,
    });
  }
  let sessionIds: string[] = [];
  if (classIds.length) {
    const { data: sess } = await supabase
      .from("class_sessions")
      .select("id, class_id")
      .in("class_id", classIds)
      .limit(1000);
    sessionIds = (sess ?? []).map((s) => s.id);
  }

  const { data: bookings } =
    sessionIds.length > 0
      ? await supabase
          .from("bookings")
          .select(
            `
          id,
          status,
          class_sessions ( class_id, classes ( title ) )
        `,
          )
          .in("session_id", sessionIds)
          .limit(2000)
      : { data: [] as const };

  const byClassAttendance: Record<string, { title: string; booked: number; attended: number }> = {};
  const byLocationAttendance: Record<string, { booked: number; attended: number }> = {};
  const byInstructor: Record<string, { booked: number; attended: number }> = {};
  for (const b of bookings ?? []) {
    if (b.status === "cancelled") continue;
    const cs = b.class_sessions as {
      class_id?: string;
      classes?: { title?: string } | null;
    } | null;
    const cid = cs?.class_id ?? "unknown";
    const title = cs?.classes?.title ?? "Class";
    if (!byClassAttendance[cid]) byClassAttendance[cid] = { title, booked: 0, attended: 0 };
    byClassAttendance[cid].booked += 1;
    if (b.status === "attended") byClassAttendance[cid].attended += 1;

    const meta = classMeta.get(cid);
    const locationKey = meta?.locationName ?? "Unassigned location";
    if (!byLocationAttendance[locationKey]) byLocationAttendance[locationKey] = { booked: 0, attended: 0 };
    byLocationAttendance[locationKey].booked += 1;
    if (b.status === "attended") byLocationAttendance[locationKey].attended += 1;

    const instructorKey = meta?.instructorName ?? "Unassigned instructor";
    if (!byInstructor[instructorKey]) byInstructor[instructorKey] = { booked: 0, attended: 0 };
    byInstructor[instructorKey].booked += 1;
    if (b.status === "attended") byInstructor[instructorKey].attended += 1;
  }

  const compareByLocation = Object.entries(byLocationAttendance).sort(
    (a, b) => b[1].attended - a[1].attended,
  );
  const compareByInstructor = Object.entries(byInstructor).sort(
    (a, b) => b[1].attended - a[1].attended,
  );
  const classAttendanceRows = Object.entries(byClassAttendance)
    .map(([id, row]) => ({
      id,
      title: row.title,
      booked: row.booked,
      attended: row.attended,
      rate: row.booked > 0 ? Math.round((row.attended / row.booked) * 100) : -1,
    }))
    .sort((a, b) => {
      if (classSort === "booked") return b.booked - a.booked;
      if (classSort === "rate") return b.rate - a.rate;
      return b.attended - a.attended;
    });
  const classRowsTop = classAttendanceRows.slice(0, classTopNSafe);

  const exportParams = new URLSearchParams();
  if (selectedStudioId) exportParams.set("studio_id", selectedStudioId);
  if (selectedLocationId) exportParams.set("location_id", selectedLocationId);
  exportParams.set("date_from", dateFrom);
  exportParams.set("date_to", dateTo);

  const lowCreditsThreshold = 2;
  const packsQuery = supabase
    .from("client_packages")
    .select(
      `
      id,
      client_id,
      credits_left,
      expiry_date,
      packages!inner ( name, studio_id ),
      users ( email )
    `,
    )
    .in("packages.studio_id", studioIds)
    .lte("credits_left", lowCreditsThreshold)
    .order("credits_left", { ascending: true })
    .limit(40);
  const { data: lowCreditRows } = await packsQuery;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Reports</h1>
        <p className={`mt-1 ${ui.muted}`}>
          {selectedLocationId ? "Selected location" : "All locations"} · Revenue uses payment{" "}
          <code className={ui.code}>created_at</code> within the date range (paid + refunded).
        </p>
      </div>

      {/* Date range filter with quick presets */}
      <div className={`${ui.card} flex flex-col gap-3`}>
        {/* Preset buttons */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "This month",  from: bounds.from,                    to: bounds.to },
            { label: "Last 30 days", from: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })(), to: new Date().toISOString().slice(0, 10) },
            { label: "Last month",  from: (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })(), to: (() => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 10); })() },
            { label: "Last 90 days", from: (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); })(), to: new Date().toISOString().slice(0, 10) },
          ].map(({ label, from, to }) => {
            const isActive = dateFrom === from && dateTo === to;
            const params = new URLSearchParams();
            if (selectedStudioId) params.set("studio_id", selectedStudioId);
            if (selectedLocationId) params.set("location_id", selectedLocationId);
            params.set("date_from", from);
            params.set("date_to", to);
            return (
              <a
                key={label}
                href={`?${params.toString()}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] inline-flex items-center ${
                  isActive
                    ? "border-teal-400 bg-teal-50 text-teal-800 dark:border-teal-600 dark:bg-teal-950/40 dark:text-teal-300"
                    : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200"
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>
        {/* Custom range */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
          {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>From</span>
              <input type="date" name="date_from" defaultValue={dateFrom} className={`${ui.input} whitespace-nowrap`} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>To</span>
              <input type="date" name="date_to" defaultValue={dateTo} className={`${ui.input} whitespace-nowrap`} />
            </label>
          </div>
          <button type="submit" className={ui.btnPrimarySm}>Apply</button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400">
            <DollarSign size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Gross revenue</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-teal-700 dark:text-teal-300">
              ${summary.gross.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            <RefreshCcw size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Refunds</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-blue-800 dark:text-blue-200">
              ${summary.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <TrendingUp size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Net revenue</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
              ${summary.net.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <div className={ui.card}>
        <h2 className={`${ui.h2} text-base`}>Net revenue by day</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>Each row: gross paid, refunds, net for that calendar day.</p>
        <ul className="mt-3 divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {byDay.map((row) => (
            <li key={row.day} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="font-medium tabular-nums text-stone-800 dark:text-stone-200">{row.day}</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                <span className="tabular-nums text-stone-600 dark:text-stone-400">
                  <span className="mr-1 text-xs">Gross</span>${row.gross.toFixed(2)}
                </span>
                <span className="tabular-nums text-stone-500 dark:text-stone-500">
                  <span className="mr-1 text-xs">Ref</span>−${row.refunds.toFixed(2)}
                </span>
                <span className="min-w-20 text-right font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                  ${row.net.toFixed(2)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {!byDay.length ? <p className={`mt-4 text-sm ${ui.muted}`}>No payments in this range.</p> : null}
      </div>

      <div className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={`${ui.h2} text-base`}>Attendance by class</h2>
          <form method="get" className="flex flex-wrap items-end gap-2">
            {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
            {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
            <input type="hidden" name="date_from" value={dateFrom} />
            <input type="hidden" name="date_to" value={dateTo} />
            <label className="flex items-center gap-1 text-xs">
              <span className={ui.muted}>Sort</span>
              <select name="class_sort" defaultValue={classSort} className={`${ui.select} h-9 py-1 text-xs`}>
                <option value="attended">Attended</option>
                <option value="booked">Booked</option>
                <option value="rate">Rate</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className={ui.muted}>Top</span>
              <input
                name="class_top_n"
                type="number"
                min={1}
                max={200}
                defaultValue={classTopNSafe}
                className={`${ui.input} h-9 w-20 py-1 text-xs`}
              />
            </label>
            <button type="submit" className={ui.btnSecondarySm}>Apply</button>
          </form>
        </div>
        <ul className="mt-3 divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {classRowsTop.map((row) => {
            const rate = row.rate >= 0 ? row.rate : null;
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1 truncate font-medium text-stone-800 dark:text-stone-200">{row.title}</span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`text-xs ${ui.muted}`}>
                    {row.attended} / {row.booked}
                  </span>
                  {rate !== null ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      rate >= 80
                        ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                        : rate >= 50
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                    }`}>
                      {rate}%
                    </span>
                  ) : <span className={ui.muted}>—</span>}
                </div>
              </li>
            );
          })}
        </ul>
        {!Object.keys(byClassAttendance).length ? (
          <p className={`mt-4 text-sm ${ui.muted}`}>No booking data in this range.</p>
        ) : null}
      </div>

      <div className={ui.card}>
        <h2 className={`${ui.h2} text-base`}>
          Low credits watchlist (≤ {lowCreditsThreshold})
        </h2>
        <ul className="mt-4 space-y-2 text-sm">
          {(lowCreditRows ?? []).map((row) => {
            const u = Array.isArray(row.users) ? row.users[0] : row.users;
            const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages;
            return (
              <li
                key={row.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900/70 dark:bg-amber-950/30"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-stone-900 dark:text-stone-100" title={u?.email ?? row.client_id ?? undefined}>
                    {u?.email ?? row.client_id ?? "unknown member"}
                  </p>
                  <p className={`mt-0.5 text-xs ${ui.muted}`}>
                    {pkg?.name ?? "Package"}
                    {row.expiry_date ? ` · exp ${new Date(row.expiry_date).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums font-medium text-amber-800 dark:text-amber-300">
                  {row.credits_left} left
                </span>
              </li>
            );
          })}
        </ul>
        {!lowCreditRows?.length ? (
          <p className={`mt-4 text-sm ${ui.muted}`}>No members with low credits right now.</p>
        ) : null}
      </div>

      <div className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={`${ui.h2} text-base`}>Recent payments (same range)</h2>
          <a className={`${ui.linkMuted} text-xs`} href={`/api/payments/export?${exportParams.toString()}`}>
            Export this range (CSV)
          </a>
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {revenuePayments.slice(0, 20).map((p) => {
            const row = p as PaymentWithBooking & { id: string; type?: string; payment_method?: string | null };
            const isPaid = p.status === "paid";
            const method = row.payment_method?.trim().toLowerCase() ?? "";
            const methodLabel = method === "paynow" ? "PayNow" : method === "cash" ? "Cash" : method ? method : null;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-100 px-3 py-2.5 dark:border-stone-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isPaid
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                      : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  }`}>
                    {p.status}
                  </span>
                  {row.type ? (
                    <span className={`text-xs ${ui.muted}`}>{row.type}</span>
                  ) : null}
                  {methodLabel ? <span className={`text-xs ${ui.muted}`}>{methodLabel}</span> : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                    ${Number(p.amount).toFixed(2)}
                  </span>
                  <span className={`text-xs ${ui.muted}`}>
                    {p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {!revenuePayments.length ? <p className={`mt-4 text-sm ${ui.muted}`}>No payments in this range.</p> : null}
      </div>

      <AdvancedDetails className={ui.card} summary="Advanced details">
        <p className={`mt-1 text-xs ${ui.muted}`}>Lower-frequency breakdowns for deeper analysis.</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className={ui.card}>
            <h2 className={`${ui.h2} text-base`}>Net revenue by location</h2>
            <p className={`mt-1 text-xs ${ui.muted}`}>Allocated by payment location_id.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {byLocation.map((row) => (
                <li
                  key={row.name}
                  className="flex flex-col gap-0.5 rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-stone-900 dark:text-stone-100">{row.name}</span>
                  <span className="tabular-nums text-stone-700 dark:text-stone-300">
                    ${row.net.toFixed(2)}{" "}
                    <span className={`text-xs ${ui.muted}`}>
                      (gross ${row.gross.toFixed(2)} · ref ${row.refunds.toFixed(2)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {!byLocation.length ? (
              <p className={`mt-4 text-sm ${ui.muted}`}>No payment rows in this range.</p>
            ) : null}
          </div>

          <div className={ui.card}>
            <h2 className={`${ui.h2} text-base`}>Net revenue by class (via booking)</h2>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Payments linked to a booking session; package-only payments appear under &quot;Other&quot;.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {byClass.map((row) => (
                <li
                  key={row.name}
                  className="flex flex-col gap-0.5 rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-stone-900 dark:text-stone-100">{row.name}</span>
                  <span className="tabular-nums text-stone-700 dark:text-stone-300">
                    ${row.net.toFixed(2)}{" "}
                    <span className={`text-xs ${ui.muted}`}>
                      (gross ${row.gross.toFixed(2)} · ref ${row.refunds.toFixed(2)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {!byClass.length ? (
              <p className={`mt-4 text-sm ${ui.muted}`}>No class-linked payments in this range.</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className={ui.card}>
            <h2 className={`${ui.h2} text-base`}>Attendance by location</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {compareByLocation.map(([name, row]) => {
                const rate = row.booked > 0 ? Math.round((row.attended / row.booked) * 100) : null;
                return (
                  <li key={name} className="flex items-center justify-between rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800">
                    <span className="text-stone-900 dark:text-stone-100">{name}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      <span className={`text-xs ${ui.muted}`}>{row.booked} / {row.attended}</span>
                      {rate !== null ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          rate >= 80 ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                            : rate >= 50 ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                        }`}>{rate}%</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!compareByLocation.length ? (
              <p className={`mt-4 text-sm ${ui.muted}`}>No location attendance data in this range.</p>
            ) : null}
          </div>

          <div className={ui.card}>
            <h2 className={`${ui.h2} text-base`}>Attendance by instructor</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {compareByInstructor.map(([name, row]) => {
                const rate = row.booked > 0 ? Math.round((row.attended / row.booked) * 100) : null;
                return (
                  <li key={name} className="flex items-center justify-between rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800">
                    <span className="text-stone-900 dark:text-stone-100">{name}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      <span className={`text-xs ${ui.muted}`}>{row.booked} / {row.attended}</span>
                      {rate !== null ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          rate >= 80 ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                            : rate >= 50 ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                        }`}>{rate}%</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!compareByInstructor.length ? (
              <p className={`mt-4 text-sm ${ui.muted}`}>No instructor attendance data in this range.</p>
            ) : null}
          </div>
        </div>
      </AdvancedDetails>
    </div>
  );
}

import { getDashboardScope } from "@/lib/dashboard";
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

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    date_from?: string;
    date_to?: string;
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
    return <p className={ui.muted}>Create a studio from the overview first.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }
  if (!["owner", "manager"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have reports access.</p>;
  }

  const bounds = monthBounds();
  const dateFrom = sp.date_from ?? bounds.from;
  const dateTo = sp.date_to ?? bounds.to;
  const fromIso = dayRangeStart(dateFrom);
  const toIso = dayRangeEnd(dateTo);

  let revenueQuery = supabase
    .from("payments")
    .select(
      `
      id,
      amount,
      type,
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

      <form method="get" className={`${ui.card} flex flex-wrap items-end gap-3`}>
        {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>From</span>
          <input type="date" name="date_from" defaultValue={dateFrom} className={ui.input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>To</span>
          <input type="date" name="date_to" defaultValue={dateTo} className={ui.input} />
        </label>
        <button type="submit" className={ui.btnPrimarySm}>
          Apply range
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={ui.statCard}>
          <p className={`text-sm font-medium ${ui.muted}`}>Gross revenue</p>
          <p className={`mt-1 text-xs ${ui.muted}`}>Sum of payments with status paid.</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-teal-700 dark:text-teal-300">
            ${summary.gross.toFixed(2)}
          </p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-sm font-medium ${ui.muted}`}>Refunds</p>
          <p className={`mt-1 text-xs ${ui.muted}`}>Sum of payments with status refunded (positive number).</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-blue-800 dark:text-blue-200">
            ${summary.refunds.toFixed(2)}
          </p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-sm font-medium ${ui.muted}`}>Net revenue</p>
          <p className={`mt-1 text-xs ${ui.muted}`}>Gross − Refunds. Dimension tables below use the same net rule.</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">
            ${summary.net.toFixed(2)}
          </p>
        </div>
      </div>

      <div className={ui.card}>
        <h2 className={`${ui.h2} text-base`}>Net revenue by day</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>Each row: gross paid, refunds, net for that calendar day.</p>
        <div className="overflow-auto">
          <table className="mt-4 min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-700">
                <th className="py-2.5 font-medium text-stone-600 dark:text-stone-400">Date</th>
                <th className="py-2.5 font-medium text-stone-600 dark:text-stone-400">Gross</th>
                <th className="py-2.5 font-medium text-stone-600 dark:text-stone-400">Refunds</th>
                <th className="py-2.5 font-medium text-stone-600 dark:text-stone-400">Net</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((row) => (
                <tr key={row.day} className="border-b border-stone-100 last:border-0 dark:border-stone-800">
                  <td className="py-2.5 text-stone-900 dark:text-stone-100">{row.day}</td>
                  <td className="py-2.5 tabular-nums">${row.gross.toFixed(2)}</td>
                  <td className="py-2.5 tabular-nums">${row.refunds.toFixed(2)}</td>
                  <td className="py-2.5 tabular-nums font-medium">${row.net.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!byDay.length ? <p className={`mt-4 text-sm ${ui.muted}`}>No payments in this range.</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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

      <div className={ui.card}>
        <h2 className={`${ui.h2} text-base`}>Bookings by class template</h2>
        <p className={`mt-2 text-xs ${ui.muted}`}>On phone, swipe horizontally to view all columns.</p>
        <div className="overflow-auto">
          <table className="mt-4 min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-700">
                <th className="py-2.5 font-medium text-stone-600 dark:text-stone-400">Class</th>
                <th className="py-2.5 font-medium text-stone-600 dark:text-stone-400">
                  Booked / attended
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byClassAttendance).map(([id, row]) => (
                <tr key={id} className="border-b border-stone-100 last:border-0 dark:border-stone-800">
                  <td className="py-2.5 text-stone-900 dark:text-stone-100">{row.title}</td>
                  <td className="py-2.5 tabular-nums text-stone-700 dark:text-stone-300">
                    {row.booked} / {row.attended}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!Object.keys(byClassAttendance).length ? (
          <p className={`mt-4 text-sm ${ui.muted}`}>No booking data yet.</p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={ui.card}>
          <h2 className={`${ui.h2} text-base`}>Attendance compare by location</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {compareByLocation.map(([name, row]) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800"
              >
                <span className="text-stone-900 dark:text-stone-100">{name}</span>
                <span className="tabular-nums text-stone-700 dark:text-stone-300">
                  {row.booked} / {row.attended}
                </span>
              </li>
            ))}
          </ul>
          {!compareByLocation.length ? (
            <p className={`mt-4 text-sm ${ui.muted}`}>No location attendance data yet.</p>
          ) : null}
        </div>

        <div className={ui.card}>
          <h2 className={`${ui.h2} text-base`}>Attendance compare by instructor</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {compareByInstructor.map(([name, row]) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800"
              >
                <span className="text-stone-900 dark:text-stone-100">{name}</span>
                <span className="tabular-nums text-stone-700 dark:text-stone-300">
                  {row.booked} / {row.attended}
                </span>
              </li>
            ))}
          </ul>
          {!compareByInstructor.length ? (
            <p className={`mt-4 text-sm ${ui.muted}`}>No instructor attendance data yet.</p>
          ) : null}
        </div>
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
                className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900/70 dark:bg-amber-950/30"
              >
                <span className="font-medium text-stone-900 dark:text-stone-100">
                  {u?.email ?? row.client_id ?? "unknown member"}
                </span>{" "}
                · {pkg?.name ?? "Package"} ·{" "}
                <span className="tabular-nums text-amber-800 dark:text-amber-300">
                  {row.credits_left} left
                </span>
                {row.expiry_date ? (
                  <span className={`ml-2 ${ui.muted}`}>
                    exp {new Date(row.expiry_date).toLocaleDateString()}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!lowCreditRows?.length ? (
          <p className={`mt-4 text-sm ${ui.muted}`}>No low-credit members right now.</p>
        ) : null}
      </div>

      <div>
        <h2 className={ui.h2}>Recent payments (same range)</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {revenuePayments.slice(0, 20).map((p) => {
            const row = p as PaymentWithBooking & { id: string; type?: string };
            return (
              <li
                key={row.id}
                className="rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800"
              >
                <span className="font-medium text-stone-800 dark:text-stone-200">{p.status}</span> ·{" "}
                <span className="text-stone-800 dark:text-stone-200">{row.type ?? "-"}</span> · $
                {Number(p.amount).toFixed(2)} ·{" "}
                <span className={ui.muted}>
                  {p.created_at ? new Date(p.created_at).toLocaleString() : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {!revenuePayments.length ? <p className={`mt-2 text-sm ${ui.muted}`}>No rows.</p> : null}
      </div>
    </div>
  );
}

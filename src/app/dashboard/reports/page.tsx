import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

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

  let paymentsQuery = supabase
    .from("payments")
    .select("amount, type, created_at, location_id")
    .in("studio_id", studioIds)
    .eq("status", "paid")
    .order("created_at", { ascending: false });
  if (selectedLocationId) paymentsQuery = paymentsQuery.eq("location_id", selectedLocationId);
  const { data: payments } = await paymentsQuery;

  const total = payments?.reduce((a, p) => a + Number(p.amount ?? 0), 0) ?? 0;

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
    .in("studio_id", studioIds);
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
      .in("class_id", classIds);
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
      : { data: [] as const };

  const byClass: Record<string, { title: string; booked: number; attended: number }> = {};
  const byLocation: Record<string, { booked: number; attended: number }> = {};
  const byInstructor: Record<string, { booked: number; attended: number }> = {};
  for (const b of bookings ?? []) {
    if (b.status === "cancelled") continue;
    const cs = b.class_sessions as {
      class_id?: string;
      classes?: { title?: string } | null;
    } | null;
    const cid = cs?.class_id ?? "unknown";
    const title = cs?.classes?.title ?? "Class";
    if (!byClass[cid]) byClass[cid] = { title, booked: 0, attended: 0 };
    byClass[cid].booked += 1;
    if (b.status === "attended") byClass[cid].attended += 1;

    const meta = classMeta.get(cid);
    const locationKey = meta?.locationName ?? "Unassigned location";
    if (!byLocation[locationKey]) byLocation[locationKey] = { booked: 0, attended: 0 };
    byLocation[locationKey].booked += 1;
    if (b.status === "attended") byLocation[locationKey].attended += 1;

    const instructorKey = meta?.instructorName ?? "Unassigned instructor";
    if (!byInstructor[instructorKey]) byInstructor[instructorKey] = { booked: 0, attended: 0 };
    byInstructor[instructorKey].booked += 1;
    if (b.status === "attended") byInstructor[instructorKey].attended += 1;
  }

  const compareByLocation = Object.entries(byLocation).sort((a, b) => b[1].attended - a[1].attended);
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
          {selectedLocationId ? "Selected location" : "All locations"}
        </p>
      </div>

      <div className={ui.statCard}>
        <p className={`text-sm font-medium ${ui.muted}`}>Total revenue (mock)</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-teal-700 dark:text-teal-300">
          ${total.toFixed(2)}
        </p>
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
              {Object.entries(byClass).map(([id, row]) => (
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
        {!Object.keys(byClass).length ? (
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
          Low credits watchlist ({"<="} {lowCreditsThreshold})
        </h2>
        <ul className="mt-4 space-y-2 text-sm">
          {(lowCreditRows ?? []).map((row) => {
            const user = Array.isArray(row.users) ? row.users[0] : row.users;
            const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages;
            return (
              <li
                key={row.id}
                className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900/70 dark:bg-amber-950/30"
              >
                <span className="font-medium text-stone-900 dark:text-stone-100">
                  {user?.email ?? row.client_id ?? "unknown client"}
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
          <p className={`mt-4 text-sm ${ui.muted}`}>No low-credit clients right now.</p>
        ) : null}
      </div>

      <div>
        <h2 className={ui.h2}>Recent payments</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {(payments ?? []).slice(0, 20).map((p) => (
            <li
              key={`${p.created_at}-${p.amount}`}
              className="rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800"
            >
              <span className="text-stone-800 dark:text-stone-200">{p.type}</span> · $
              {Number(p.amount).toFixed(2)} ·{" "}
              <span className={ui.muted}>
                {p.created_at ? new Date(p.created_at).toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

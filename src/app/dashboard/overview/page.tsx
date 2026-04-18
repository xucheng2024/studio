import Link from "next/link";
import { createStudio } from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function DashboardOverviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const { data: studios } = await supabase
    .from("studios")
    .select("id, name")
    .in("id", studioIds);
  const studio =
    (selectedStudioId ? studios?.find((s) => s.id === selectedStudioId) : null) ?? studios?.[0];

  if (!studio) {
    return (
      <div className="max-w-lg">
        <h1 className={ui.h1}>Create your studio</h1>
        <p className={`mt-2 ${ui.lead}`}>Name it and pick a URL slug for your QR booking page.</p>
        <form action={createStudio} className={`${ui.card} mt-8 flex flex-col gap-4`}>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Studio name</span>
            <input
              name="name"
              required
              className={ui.input}
              placeholder="Downtown Gym"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Public URL slug (QR)</span>
            <input
              name="public_slug"
              required
              minLength={3}
              maxLength={60}
              pattern="[a-zA-Z0-9-]+"
              placeholder="downtown-gym"
              title="Letters, numbers, hyphens only"
              className={`${ui.input} font-mono text-sm`}
            />
          </label>
          <p className={`text-xs ${ui.muted}`}>
            Live at <code className={ui.code}>/booking/your-slug</code> — stored lowercase.
          </p>
          <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Saving...">
            Save studio
          </SubmitButton>
        </form>
      </div>
    );
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  let sessionsQuery = supabase
    .from("class_sessions")
    .select(
      `
      id,
      start_time,
      classes!inner ( title, studio_id )
    `,
    )
    .in("classes.studio_id", studioIds)
    .gte("start_time", start.toISOString())
    .lt("start_time", end.toISOString());
  if (selectedLocationId) sessionsQuery = sessionsQuery.eq("location_id", selectedLocationId);
  const { data: todaySessions } = await sessionsQuery;

  const sessionIds = (todaySessions ?? []).map((s) => s.id);

  let bookingsToday = 0;
  if (sessionIds.length) {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("session_id", sessionIds)
      .eq("status", "booked");
    bookingsToday = count ?? 0;
  }

  let paymentsQuery = supabase
    .from("payments")
    .select("amount, location_id")
    .in("studio_id", studioIds)
    .eq("status", "paid");
  if (selectedLocationId) paymentsQuery = paymentsQuery.eq("location_id", selectedLocationId);
  const { data: payments } = await paymentsQuery;

  const revenue = payments?.reduce((a, p) => a + Number(p.amount ?? 0), 0) ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className={ui.h1}>{studio.name}</h1>
          <p className={`mt-1 ${ui.muted}`}>Today at a glance</p>
        </div>
        <Link href="/dashboard/qr" className={`${ui.btnSecondarySm} shrink-0`}>
          QR & link
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className={ui.statCard}>
          <p className={`text-sm font-medium ${ui.muted}`}>Classes today</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
            {todaySessions?.length ?? 0}
          </p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-sm font-medium ${ui.muted}`}>Bookings today</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
            {bookingsToday}
          </p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-sm font-medium ${ui.muted}`}>Revenue (paid)</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-teal-700 dark:text-teal-300">
            ${revenue.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}

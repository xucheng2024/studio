import Link from "next/link";
import { createStudio } from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { CalendarDays, Users, DollarSign } from "lucide-react";

type Props = {
  searchParams: Promise<{ location_id?: string; studio_id?: string; create_error?: string }>;
};

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
    const createErr =
      sp.create_error === "owner_grant_required"
        ? "Your platform owner access is not active. Ask a platform admin to enable it before creating a new studio."
        : null;
    return (
      <div className="max-w-lg">
        <h1 className={ui.h1}>Create your studio</h1>
        <p className={`mt-2 ${ui.lead}`}>Name it and pick a URL slug for your public booking page.</p>
        {createErr ? <p className={`${ui.error} mt-4`}>{createErr}</p> : null}
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
            <span className={ui.label}>Public URL slug</span>
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
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
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

  // Scope revenue to current calendar month to avoid loading full payment history.
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  let paymentsQuery = supabase
    .from("payments")
    .select("amount")
    .in("studio_id", studioIds)
    .eq("status", "paid")
    .gte("created_at", monthStart.toISOString());
  if (selectedLocationId) paymentsQuery = paymentsQuery.eq("location_id", selectedLocationId);
  const { data: payments } = await paymentsQuery;

  const revenue = payments?.reduce((a, p) => a + Number(p.amount ?? 0), 0) ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={ui.h1}>{studio.name}</h1>
          <p className={`mt-1 ${ui.muted}`}>Today at a glance</p>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link
          href={`/dashboard/schedule?studio_id=${selectedStudioId ?? studioIds[0]}`}
          className={`${ui.statCard} flex items-center gap-4 transition-shadow hover:shadow-md`}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
            <CalendarDays size={18} />
          </div>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Classes today</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
              {todaySessions?.length ?? 0}
            </p>
          </div>
        </Link>
        <Link
          href={`/dashboard/schedule?studio_id=${selectedStudioId ?? studioIds[0]}`}
          className={`${ui.statCard} flex items-center gap-4 transition-shadow hover:shadow-md`}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
            <Users size={18} />
          </div>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Bookings today</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
              {bookingsToday}
            </p>
          </div>
        </Link>
        <Link
          href={`/dashboard/payments?studio_id=${selectedStudioId ?? studioIds[0]}`}
          className={`${ui.statCard} flex items-center gap-4 transition-shadow hover:shadow-md`}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400">
            <DollarSign size={18} />
          </div>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Revenue this month</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-teal-700 dark:text-teal-300">
              ${revenue.toFixed(2)}
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}

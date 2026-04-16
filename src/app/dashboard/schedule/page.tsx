import { createRecurringRule, createSession, saveBookingRules } from "@/app/dashboard/actions";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { MarkAttendedButton } from "@/components/MarkAttendedButton";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function SchedulePage({ searchParams }: Props) {
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
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have schedule access.</p>;
  }

  let classesQuery = supabase
    .from("classes")
    .select("id, title, studio_id, location_id")
    .in("studio_id", studioIds)
    .order("title");
  if (selectedLocationId) classesQuery = classesQuery.eq("location_id", selectedLocationId);
  const { data: classes } = await classesQuery;

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");
  const selectedLocation = selectedLocationId
    ? (locations ?? []).find((l) => l.id === selectedLocationId)
    : null;
  const activeStudioId = selectedLocation?.studio_id ?? (classes?.[0]?.studio_id ?? studioIds[0]);

  let sessionQuery = supabase
    .from("class_sessions")
    .select(
      `
      id,
      start_time,
      end_time,
      spots_left,
      classes!inner ( title, studio_id ),
      bookings (
        id,
        client_id,
        status,
        guest_name,
        guest_email,
        users ( email )
      )
    `,
    )
    .in("classes.studio_id", studioIds)
    .order("start_time", { ascending: true });
  if (selectedLocationId) sessionQuery = sessionQuery.eq("location_id", selectedLocationId);
  const { data: sessions } = await sessionQuery;
  const rulesQuery = supabase
    .from("booking_rules")
    .select(
      "id, cancel_cutoff_hours, no_show_buffer_min, max_active_bookings_per_client, max_weekly_late_cancel, late_cancel_deduct_credit, no_show_deduct_credit, allow_waitlist",
    )
    .eq("studio_id", activeStudioId)
    .limit(1);
  const { data: activeRules } = selectedLocationId
    ? await rulesQuery.eq("location_id", selectedLocationId).maybeSingle()
    : await rulesQuery.is("location_id", null).maybeSingle();

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className={ui.h1}>Schedule</h1>
        <p className={`mt-1 ${ui.muted}`}>Add sessions from your class templates.</p>
        <h2 className={`${ui.h2} mt-8`}>Booking rules</h2>
        <form action={saveBookingRules} className={`${ui.card} mt-4 grid max-w-xl gap-4 md:grid-cols-2`}>
          <input type="hidden" name="studio_id" value={activeStudioId} />
          <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Cancel cutoff (hours)</span>
            <input
              type="number"
              min={0}
              name="cancel_cutoff_hours"
              defaultValue={activeRules?.cancel_cutoff_hours ?? 12}
              className={ui.input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>No-show buffer (minutes)</span>
            <input
              type="number"
              min={0}
              name="no_show_buffer_min"
              defaultValue={activeRules?.no_show_buffer_min ?? 15}
              className={ui.input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Max active bookings / member</span>
            <input
              type="number"
              min={1}
              name="max_active_bookings_per_client"
              defaultValue={activeRules?.max_active_bookings_per_client ?? 3}
              className={ui.input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Max weekly late-cancel/no-show</span>
            <input
              type="number"
              min={0}
              name="max_weekly_late_cancel"
              defaultValue={activeRules?.max_weekly_late_cancel ?? 2}
              className={ui.input}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            <input
              type="checkbox"
              name="late_cancel_deduct_credit"
              defaultChecked={activeRules?.late_cancel_deduct_credit ?? true}
            />
            Late cancel deducts credit
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            <input
              type="checkbox"
              name="no_show_deduct_credit"
              defaultChecked={activeRules?.no_show_deduct_credit ?? true}
            />
            No-show deducts credit
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300 md:col-span-2">
            <input
              type="checkbox"
              name="allow_waitlist"
              defaultChecked={activeRules?.allow_waitlist ?? false}
            />
            Allow waitlist
          </label>
          <button type="submit" className={`${ui.btnSecondary} md:col-span-2 w-fit`}>
            Save booking rules
          </button>
        </form>

        <form action={createSession} className={`${ui.card} mt-6 flex max-w-md flex-col gap-4`}>
          <input type="hidden" name="studio_id" value={activeStudioId} />
          <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Class</span>
            <select name="class_id" required className={ui.select}>
              <option value="">Select…</option>
              {(classes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Start</span>
            <input name="start_time" type="datetime-local" required className={ui.input} />
          </label>
          <button type="submit" className={`${ui.btnPrimary} w-full sm:w-auto`}>
            Create session
          </button>
        </form>

        <h2 className={`${ui.h2} mt-8`}>Recurring weekly schedule</h2>
        <form action={createRecurringRule} className={`${ui.card} mt-4 grid max-w-xl gap-4 md:grid-cols-2`}>
          <input type="hidden" name="studio_id" value={activeStudioId} />
          <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className={ui.label}>Class</span>
            <select name="class_id" required className={ui.select}>
              <option value="">Select…</option>
              {(classes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Weekdays (comma)</span>
            <input name="by_weekday" defaultValue="mon,wed" className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Start date</span>
            <input type="date" name="start_date" required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>End date (optional)</span>
            <input type="date" name="end_date" className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Start time</span>
            <input type="time" name="start_time" required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Duration</span>
            <input type="number" name="duration_min" defaultValue={60} min={15} className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Capacity</span>
            <input type="number" name="capacity" defaultValue={10} min={1} className={ui.input} />
          </label>
          <button type="submit" className={`${ui.btnSecondary} md:col-span-2 w-fit`}>
            Create recurring rule (8 weeks)
          </button>
        </form>
      </div>

      <div>
        <h2 className={ui.h2}>Upcoming sessions</h2>
        <ul className="mt-4 flex flex-col gap-4">
          {(sessions ?? []).map((s) => {
            const cls = s.classes as { title?: string } | null;
            const bookings = (s.bookings ?? []) as {
              id: string;
              client_id: string | null;
              status: string;
              guest_name?: string | null;
              guest_email?: string | null;
              users?: { email?: string | null } | null;
            }[];
            return (
              <li key={s.id} className={ui.card}>
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-medium text-stone-900 dark:text-stone-100">
                      {cls?.title ?? "Class"}
                    </p>
                    <p className={`${ui.muted} mt-0.5 text-sm`}>
                      {new Date(s.start_time).toLocaleString()} –{" "}
                      {new Date(s.end_time).toLocaleString()}
                    </p>
                    <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                      {s.spots_left} spots left
                    </p>
                  </div>
                </div>
                <ul className="mt-4 flex flex-col gap-2 border-t border-stone-100 pt-3 text-sm dark:border-stone-800">
                  {bookings.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-stone-800 dark:text-stone-200">
                        {b.client_id
                          ? (b.users?.email ?? b.client_id)
                          : `${b.guest_name ?? "Guest"} · ${b.guest_email ?? ""}`}
                      </span>
                      <span className={ui.muted}>({b.status})</span>
                      {b.status === "booked" ? (
                        <>
                          <MarkAttendedButton bookingId={b.id} />
                          <CancelBookingButton bookingId={b.id} />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
        {!sessions?.length ? (
          <p className={`mt-4 text-sm ${ui.muted}`}>No sessions scheduled.</p>
        ) : null}
      </div>
    </div>
  );
}

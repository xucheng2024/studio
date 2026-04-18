import { DashboardAppLink } from "@/components/DashboardAppLink";
import { createRecurringRule, createSession, saveBookingRules } from "@/app/dashboard/actions";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { CancelSessionButton } from "@/components/CancelSessionButton";
import { MarkAttendedButton } from "@/components/MarkAttendedButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    session_status?: "all" | "scheduled" | "cancelled";
    q?: string;
  }>;
};

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
    return <p className={ui.muted}>Create your first studio in Overview.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
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
  const scopeParams = new URLSearchParams();
  scopeParams.set("studio_id", activeStudioId);
  if (selectedLocationId) scopeParams.set("location_id", selectedLocationId);

  let sessionQuery = supabase
    .from("class_sessions")
    .select(
      `
      id,
      start_time,
      end_time,
      spots_left,
      status,
      location_id,
      classes!inner ( title, studio_id ),
      locations ( id, name ),
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
  const sessionStatusFilter = sp.session_status ?? "all";
  const keyword = (sp.q ?? "").trim().toLowerCase();
  const sessionRows = sessions ?? [];
  const filteredSessions = sessionRows.filter((s) => {
    const status = (s as { status?: string | null }).status ?? "scheduled";
    if (sessionStatusFilter !== "all" && status !== sessionStatusFilter) return false;
    if (!keyword) return true;
    const cls = s.classes as { title?: string } | null;
    const loc = s.locations as { name?: string | null } | { name?: string | null }[] | null;
    const locationName = Array.isArray(loc) ? loc[0]?.name ?? "" : loc?.name ?? "";
    const bookings = (s.bookings ?? []) as Array<{
      guest_name?: string | null;
      guest_email?: string | null;
      users?: { email?: string | null } | null;
    }>;
    const bookingFields = bookings.flatMap((b) => [b.guest_name, b.guest_email, b.users?.email]);
    return [cls?.title, locationName, ...bookingFields]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(keyword));
  });
  const scheduledCount = sessionRows.filter((s) => ((s as { status?: string }).status ?? "scheduled") === "scheduled").length;
  const cancelledCount = sessionRows.filter((s) => ((s as { status?: string }).status ?? "scheduled") === "cancelled").length;
  const bookingCount = sessionRows.reduce((acc, s) => {
    const bookings = (s.bookings ?? []) as Array<{ status?: string | null }>;
    return (
      acc +
      bookings.filter((b) => {
        const st = b.status ?? "";
        return st === "booked" || st === "pending";
      }).length
    );
  }, 0);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className={ui.h1}>Schedule</h1>
        <p className={`mt-1 ${ui.muted}`}>Add sessions from your class templates.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <DashboardAppLink href={`/dashboard/classes?${scopeParams.toString()}`} className={ui.btnSecondarySm}>
            Manage classes
          </DashboardAppLink>
          <DashboardAppLink href={`/dashboard/packages?${scopeParams.toString()}`} className={ui.btnSecondarySm}>
            Manage packages
          </DashboardAppLink>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className={ui.statCard}>
            <p className={`text-xs ${ui.muted}`}>Visible sessions</p>
            <p className="mt-1 text-xl font-semibold">{sessionRows.length}</p>
          </div>
          <div className={ui.statCard}>
            <p className={`text-xs ${ui.muted}`}>Scheduled / cancelled</p>
            <p className="mt-1 text-xl font-semibold">
              {scheduledCount} / {cancelledCount}
            </p>
          </div>
          <div className={ui.statCard}>
            <p className={`text-xs ${ui.muted}`}>Active bookings</p>
            <p className="mt-1 text-xl font-semibold">{bookingCount}</p>
          </div>
        </div>
        <details className={`${ui.card} mt-8 max-w-xl`} id="booking-rules">
          <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-stone-900 dark:text-stone-100">
            <span>Booking rules</span>
            <span className={`text-xs font-normal ${ui.muted}`}>Expand settings</span>
          </summary>
          <p className={`mt-1 text-xs ${ui.muted}`}>Low-frequency settings. Open only when updating policy.</p>
          <form action={saveBookingRules} className="mt-4 grid gap-4 md:grid-cols-2">
            <input type="hidden" name="studio_id" value={activeStudioId} />
            <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Free cancellation window (hours before class)</span>
              <input
                type="number"
                min={0}
                name="cancel_cutoff_hours"
                defaultValue={activeRules?.cancel_cutoff_hours ?? 12}
                className={ui.input}
              />
              <span className={`text-xs ${ui.muted}`}>If cancelled inside this window, it counts as late cancel.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>No-show grace period (minutes after class starts)</span>
              <input
                type="number"
                min={0}
                name="no_show_buffer_min"
                defaultValue={activeRules?.no_show_buffer_min ?? 15}
                className={ui.input}
              />
              <span className={`text-xs ${ui.muted}`}>After this, un-checked-in bookings can be marked as no-show.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Max active bookings per member</span>
              <input
                type="number"
                min={1}
                name="max_active_bookings_per_client"
                defaultValue={activeRules?.max_active_bookings_per_client ?? 3}
                className={ui.input}
              />
              <span className={`text-xs ${ui.muted}`}>Blocks over-booking by the same member.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Max weekly late cancel / no-show before block</span>
              <input
                type="number"
                min={0}
                name="max_weekly_late_cancel"
                defaultValue={activeRules?.max_weekly_late_cancel ?? 2}
                className={ui.input}
              />
              <span className={`text-xs ${ui.muted}`}>Member can be blocked from new bookings after reaching this limit.</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
              <input
                type="checkbox"
                name="late_cancel_deduct_credit"
                defaultChecked={activeRules?.late_cancel_deduct_credit ?? true}
              />
              Deduct 1 credit for late cancel
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
              <input
                type="checkbox"
                name="no_show_deduct_credit"
                defaultChecked={activeRules?.no_show_deduct_credit ?? true}
              />
              Deduct 1 credit for no-show
            </label>
            <div className="md:col-span-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-300">
              Example: Class starts at 7:00 PM. With 12h cancellation window, cancelling at 10:00 AM is free; cancelling at
              6:00 PM is late cancel.
            </div>
            <SubmitButton className={`${ui.btnSecondary} md:col-span-2 w-fit`} pendingText="Saving...">
              Save booking rules
            </SubmitButton>
          </form>
        </details>

        <h2 className={`${ui.h2} mt-8`}>Create session</h2>
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
          <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Creating...">
            Create session
          </SubmitButton>
        </form>

        <details className={`${ui.card} mt-8 max-w-xl`} id="recurring-schedule">
          <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-stone-900 dark:text-stone-100">
            <span>Recurring weekly schedule</span>
            <span className={`text-xs font-normal ${ui.muted}`}>Expand advanced</span>
          </summary>
          <p className={`mt-1 text-xs ${ui.muted}`}>Advanced setup. Use when you need auto-generated sessions.</p>
          <form action={createRecurringRule} className="mt-4 grid gap-4 md:grid-cols-2">
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
            <SubmitButton className={`${ui.btnSecondary} md:col-span-2 w-fit`} pendingText="Creating...">
              Create recurring rule (8 weeks)
            </SubmitButton>
          </form>
        </details>
      </div>

      <div>
        <h2 className={ui.h2}>Upcoming sessions</h2>
        <form method="get" className={`${ui.card} mt-4 grid gap-3 sm:grid-cols-3`}>
          {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
          {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Session status</span>
            <select name="session_status" className={ui.select} defaultValue={sessionStatusFilter}>
              <option value="all">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Search class / member / location</span>
            <input name="q" className={ui.input} defaultValue={sp.q ?? ""} placeholder="Yoga Flow, alice@mail..." />
          </label>
          <div className="flex items-end gap-2">
            <SubmitButton className={ui.btnPrimarySm} pendingText="Applying...">
              Apply
            </SubmitButton>
            <DashboardAppLink href={`/dashboard/schedule?${scopeParams.toString()}`} className={ui.btnGhost}>
              Reset
            </DashboardAppLink>
          </div>
        </form>
        <ul className="mt-4 flex flex-col gap-4">
          {filteredSessions.map((s) => {
            const cls = s.classes as { title?: string } | null;
            const loc = s.locations as { name?: string | null } | { name?: string | null }[] | null;
            const locationName = Array.isArray(loc) ? loc[0]?.name ?? null : loc?.name ?? null;
            const sessionStatus = (s as { status?: string | null }).status ?? "scheduled";
            const bookings = (s.bookings ?? []) as {
              id: string;
              client_id: string | null;
              status: string;
              guest_name?: string | null;
              guest_email?: string | null;
              users?: { email?: string | null } | null;
            }[];
            const activeBookingCount = bookings.filter((b) => b.status === "booked" || b.status === "pending").length;
            return (
              <li key={s.id} className={ui.card}>
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-stone-900 dark:text-stone-100">
                        {cls?.title ?? "Class"}
                      </p>
                      {sessionStatus === "cancelled" ? (
                        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-800 dark:bg-stone-700 dark:text-stone-200">
                          Cancelled
                        </span>
                      ) : null}
                    </div>
                    {locationName ? (
                      <p className={`mt-0.5 text-sm ${ui.muted}`}>{locationName}</p>
                    ) : null}
                    <p className={`${ui.muted} mt-0.5 text-sm`}>
                      {new Date(s.start_time).toLocaleString()} –{" "}
                      {new Date(s.end_time).toLocaleString()}
                    </p>
                    <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                      {s.spots_left} spots left · {activeBookingCount} active bookings
                    </p>
                  </div>
                  <CancelSessionButton
                    sessionId={s.id}
                    classTitle={cls?.title ?? "Class"}
                    startTimeIso={String(s.start_time)}
                    locationName={locationName}
                    sessionStatus={sessionStatus}
                  />
                </div>
                <ul className="mt-4 flex flex-col gap-2 border-t border-stone-100 pt-3 text-sm dark:border-stone-800">
                  {bookings.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-stone-800 dark:text-stone-200">
                        {b.client_id
                          ? (b.users?.email ?? b.client_id)
                          : `${b.guest_name ?? "Guest"} · ${b.guest_email ?? ""}`}
                      </span>
                      {(() => {
                        const badge = getUnifiedStatusBadges({ booking_status: b.status }).booking;
                        return (
                          <span className={`rounded-full px-2 py-0.5 text-xs ${badgeToneClass(badge.tone)}`}>
                            {badge.text}
                          </span>
                        );
                      })()}
                      {b.status === "booked" ? (
                        <>
                          <MarkAttendedButton bookingId={b.id} />
                          <CancelBookingButton bookingId={b.id} />
                        </>
                      ) : null}
                    </li>
                  ))}
                  {!bookings.length ? <li className={ui.muted}>No bookings yet.</li> : null}
                </ul>
              </li>
            );
          })}
        </ul>
        {!filteredSessions.length ? (
          <p className={`mt-4 text-sm ${ui.muted}`}>No upcoming sessions match this filter.</p>
        ) : null}
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { studioHomePath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyBookingsPage({ params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);
  if (!studioSlug) redirect("/");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/me/bookings`)}`);
  const browseClassesHref = `${studioHomePath(studioSlug)}#upcoming-classes`;
  const { data: studio } = await supabase
    .from("studios")
    .select("id")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio?.id) redirect("/");
  await mergeGuestRecordsForUser(user.id, user.email);

  const { data: classBookings } = await supabase
    .from("bookings")
    .select(`
      id,
      status,
      payment_status,
      created_at,
      cancelled_at,
      location_id,
      class_sessions (
        start_time,
        classes ( title, studio_id )
      )
    `)
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });

  const { data: eventBookings } = await supabase
    .from("event_bookings")
    .select(`
      id,
      status,
      payment_status,
      created_at,
      events (
        title,
        start_time,
        studio_id
      )
    `)
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });

  const classLocationIds = Array.from(
    new Set(
      (classBookings ?? [])
        .map((b) => b.location_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const { data: locationRows } = classLocationIds.length
    ? await supabase.from("locations").select("id, name").in("id", classLocationIds)
    : { data: [] as { id: string; name: string | null }[] };
  const locationMap = new Map((locationRows ?? []).map((loc) => [loc.id, loc.name ?? "Selected branch"]));

  const items = [
    ...(classBookings ?? []).map((b) => ({ kind: "class" as const, created_at: b.created_at, data: b })),
    ...(eventBookings ?? []).map((b) => ({ kind: "event" as const, created_at: b.created_at, data: b })),
  ]
    .filter((item) => {
      if (item.kind === "class") {
        const session = Array.isArray(item.data.class_sessions) ? item.data.class_sessions[0] : item.data.class_sessions;
        const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
        return cls?.studio_id === studio.id;
      }
      const event = Array.isArray(item.data.events) ? item.data.events[0] : item.data.events;
      return event?.studio_id === studio.id;
    })
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-10">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div>
            <h1 className={ui.h1}>My bookings</h1>
            <p className={`mt-1 ${ui.muted}`}>Your class and event bookings.</p>
          </div>
        </div>

        {/* ── Bookings ─────────────────────────────────────────────── */}
        <section>
          <ul className="mt-4 flex flex-col gap-3">
            {items.map((item) => {
              if (item.kind === "class") {
                const b = item.data;
                const session = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
                const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
                const bookingBadge = getUnifiedStatusBadges({ booking_status: b.status }).booking;
                const isPast = session?.start_time ? new Date(session.start_time) < new Date() : false;
                const dt = session?.start_time ? new Date(session.start_time) : null;
                const timeLabel = dt
                  ? dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" })
                  : null;
                const bookedAtLabel = b.created_at
                  ? new Date(b.created_at).toLocaleString("en-SG", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Singapore",
                    })
                  : null;
                const locationLabel = b.location_id
                  ? (locationMap.get(b.location_id) ?? "Selected branch")
                  : "All locations";
                const weekday = dt ? dt.toLocaleDateString("en-SG", { weekday: "short", timeZone: "Asia/Singapore" }) : "";
                const dayNum = dt ? dt.getDate() : "";
                const month = dt ? dt.toLocaleDateString("en-SG", { month: "short", timeZone: "Asia/Singapore" }) : "";
                const singleBadge = bookingBadge;
                return (
                  <li key={`class-${b.id}`} className={`${ui.card} ${isPast ? "opacity-70" : ""}`}>
                    <div className="flex items-start gap-3">
                      {dt ? (
                        <div className="flex w-11 shrink-0 flex-col items-center rounded-xl border border-stone-200 bg-stone-50 py-1 dark:border-stone-700 dark:bg-stone-800">
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                            {weekday}
                          </span>
                          <span className="text-base font-bold leading-tight text-stone-900 dark:text-stone-50">
                            {dayNum}
                          </span>
                          <span className="text-[9px] text-stone-500 dark:text-stone-400">{month}</span>
                        </div>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold leading-tight text-stone-900 dark:text-stone-100">{cls?.title ?? "Class"}</p>
                            {timeLabel ? <p className={`mt-0.5 text-sm ${ui.muted}`}>{timeLabel}</p> : null}
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeToneClass(singleBadge.tone)}`}>
                            {singleBadge.text}
                          </span>
                        </div>
                        <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                          <span>Class</span>
                          <span>Location: {locationLabel}</span>
                        </div>
                        {bookedAtLabel ? <p className={`mt-1 text-xs ${ui.muted}`}>Booked on {bookedAtLabel}</p> : null}
                      </div>
                    </div>
                  </li>
                );
              }

              const b = item.data;
              const event = Array.isArray(b.events) ? b.events[0] : b.events;
              const bookingBadge = getUnifiedStatusBadges({ booking_status: b.status }).booking;
              const dt = event?.start_time ? new Date(event.start_time) : null;
              const isPast = dt ? dt < new Date() : false;
              const timeLabel = dt
                ? dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" })
                : null;
              const bookedAtLabel = b.created_at
                ? new Date(b.created_at).toLocaleString("en-SG", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Singapore",
                  })
                : null;
              const weekday = dt ? dt.toLocaleDateString("en-SG", { weekday: "short", timeZone: "Asia/Singapore" }) : "";
              const dayNum = dt ? dt.getDate() : "";
              const month = dt ? dt.toLocaleDateString("en-SG", { month: "short", timeZone: "Asia/Singapore" }) : "";
              return (
                <li key={`event-${b.id}`} className={`${ui.card} ${isPast ? "opacity-70" : ""}`}>
                  <div className="flex items-start gap-3">
                    {dt ? (
                      <div className="flex w-11 shrink-0 flex-col items-center rounded-xl border border-stone-200 bg-stone-50 py-1 dark:border-stone-700 dark:bg-stone-800">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          {weekday}
                        </span>
                        <span className="text-base font-bold leading-tight text-stone-900 dark:text-stone-50">
                          {dayNum}
                        </span>
                        <span className="text-[9px] text-stone-500 dark:text-stone-400">
                          {month}
                        </span>
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold leading-tight text-stone-900 dark:text-stone-100">{event?.title ?? "Event"}</p>
                          {timeLabel ? <p className={`mt-0.5 text-sm ${ui.muted}`}>{timeLabel}</p> : null}
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeToneClass(bookingBadge.tone)}`}>
                          {bookingBadge.text}
                        </span>
                      </div>
                      <p className={`mt-1.5 text-xs ${ui.muted}`}>Event</p>
                      {bookedAtLabel ? <p className={`mt-0.5 text-xs ${ui.muted}`}>Booked on {bookedAtLabel}</p> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {!items.length ? (
            <div className={`mt-4 ${ui.emptyState}`}>
              <p className={`text-sm ${ui.muted}`}>No bookings yet.</p>
              <a href={browseClassesHref} className={ui.link}>Browse classes →</a>
            </div>
          ) : null}
        </section>

      </div>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { badgeToneClass } from "@/lib/order-status";
import { studioClassesPath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

const paymentStatusColor: Record<string, string> = {
  paid: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/50",
  pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50",
  failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50",
  expired: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
  refunded: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
};

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyOrdersPage({ params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);
  if (!studioSlug) redirect("/");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/me/orders`)}`);
  const { data: studio } = await supabase
    .from("studios")
    .select("id")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio?.id) redirect("/");

  const { data: payments } = await supabase
    .from("payments")
    .select("id, studio_id, amount, currency, status, created_at, reference_code, payment_method, source, booking_id, event_booking_id, package_id, package_name_snapshot, membership_name_snapshot, member_zone_series_id, member_zone_lesson_id")
    .eq("client_id", user.id)
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: false });

  const bookingIds = Array.from(
    new Set((payments ?? []).map((p) => p.booking_id).filter((v): v is string => typeof v === "string" && v.length > 0)),
  );
  const eventBookingIds = Array.from(
    new Set((payments ?? []).map((p) => (p as { event_booking_id?: string | null }).event_booking_id).filter((v): v is string => typeof v === "string" && v.length > 0)),
  );
  const packageIds = Array.from(
    new Set((payments ?? []).map((p) => p.package_id).filter((v): v is string => typeof v === "string" && v.length > 0)),
  );
  const memberZoneSeriesIds = Array.from(
    new Set((payments ?? []).map((p) => (p as { member_zone_series_id?: string | null }).member_zone_series_id).filter((v): v is string => typeof v === "string" && v.length > 0)),
  );
  const memberZoneLessonIds = Array.from(
    new Set((payments ?? []).map((p) => (p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id).filter((v): v is string => typeof v === "string" && v.length > 0)),
  );

  const { data: bookingRows } =
    bookingIds.length > 0
      ? await supabase
          .from("bookings")
          .select("id, class_sessions(start_time, classes(title))")
          .in("id", bookingIds)
      : { data: [] };
  const { data: eventBookingRows } =
    eventBookingIds.length > 0
      ? await supabase
          .from("event_bookings")
          .select("id, events(title, start_time)")
          .in("id", eventBookingIds)
      : { data: [] };
  const { data: packageRows } =
    packageIds.length > 0
      ? await supabase
          .from("packages")
          .select("id, name")
          .in("id", packageIds)
      : { data: [] };
  const { data: memberZoneSeriesRows } =
    memberZoneSeriesIds.length > 0
      ? await supabase
          .from("member_zone_series")
          .select("id, title")
          .in("id", memberZoneSeriesIds)
      : { data: [] };
  const { data: memberZoneLessonRows } =
    memberZoneLessonIds.length > 0
      ? await supabase
          .from("member_zone_lessons")
          .select("id, title")
          .in("id", memberZoneLessonIds)
      : { data: [] };

  const bookingMap = new Map((bookingRows ?? []).map((r) => [r.id, r]));
  const eventBookingMap = new Map((eventBookingRows ?? []).map((r) => [r.id, r]));
  const packageMap = new Map((packageRows ?? []).map((r) => [r.id, r]));
  const memberZoneSeriesMap = new Map((memberZoneSeriesRows ?? []).map((r) => [r.id, r]));
  const memberZoneLessonMap = new Map((memberZoneLessonRows ?? []).map((r) => [r.id, r]));

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className={ui.h1}>My orders</h1>
          <p className={`mt-1 ${ui.muted}`}>Your payment and order records.</p>
        </div>

        <ul className="flex flex-col gap-2">
          {(payments ?? []).map((p) => {
            const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
            const eventBooking = (p as { event_booking_id?: string | null }).event_booking_id
              ? eventBookingMap.get((p as { event_booking_id?: string | null }).event_booking_id ?? "")
              : null;
            const pkg = p.package_id ? packageMap.get(p.package_id) : null;
            const memberZoneSeries = (p as { member_zone_series_id?: string | null }).member_zone_series_id
              ? memberZoneSeriesMap.get((p as { member_zone_series_id?: string | null }).member_zone_series_id ?? "")
              : null;
            const memberZoneLesson = (p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id
              ? memberZoneLessonMap.get((p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id ?? "")
              : null;
            const session = booking && "class_sessions" in booking ? booking.class_sessions : null;
            const sessionRow = Array.isArray(session) ? session[0] : session;
            const cls = Array.isArray(sessionRow?.classes) ? sessionRow?.classes[0] : sessionRow?.classes;
            const sessionTitle = cls?.title ?? null;
            const sessionTime = sessionRow?.start_time
              ? new Date(sessionRow.start_time).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" })
              : null;
            const eventInfo = eventBooking && "events" in eventBooking ? eventBooking.events : null;
            const eventRow = Array.isArray(eventInfo) ? eventInfo[0] : eventInfo;
            const eventTitle = eventRow?.title ?? null;
            const eventTime = eventRow?.start_time
              ? new Date(eventRow.start_time).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" })
              : null;
            const source = (p as { source?: string | null }).source ?? null;
            const sourceBadge =
              source === "event_booking"
                ? { text: "Event", tone: "amber" as const }
                : source === "membership_subscription"
                  ? { text: "Membership", tone: "teal" as const }
                : source === "member_zone_purchase"
                  ? { text: "Member zone", tone: "teal" as const }
                : source === "package_buy"
                  ? { text: "Package", tone: "stone" as const }
                  : { text: "Class", tone: "blue" as const };

            return (
              <li key={p.id} className={ui.card}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-stone-900 dark:text-stone-100">
                      {p.currency} {Number(p.amount).toFixed(2)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeToneClass(sourceBadge.tone)}`}>
                      {sourceBadge.text}
                    </span>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${paymentStatusColor[p.status ?? ""] ?? paymentStatusColor.pending}`}>
                    {p.status ?? "Unknown"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {p.payment_method ? <span className="capitalize">{p.payment_method}</span> : null}
                  {p.reference_code ? <span>Ref: {p.reference_code}</span> : null}
                  {p.created_at ? (
                    <span>{new Date(p.created_at).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" })}</span>
                  ) : null}
                </div>
                {sessionTitle ? (
                  <p className={`mt-2 text-sm ${ui.muted}`}>Session: {sessionTitle}{sessionTime ? ` · ${sessionTime}` : ""}</p>
                ) : null}
                {eventTitle ? (
                  <p className={`mt-2 text-sm ${ui.muted}`}>Event: {eventTitle}{eventTime ? ` · ${eventTime}` : ""}</p>
                ) : null}
                {(((p as { package_name_snapshot?: string | null }).package_name_snapshot?.trim()) || pkg?.name) ? (
                  <p className={`mt-1 text-sm ${ui.muted}`}>
                    Package: {(p as { package_name_snapshot?: string | null }).package_name_snapshot?.trim() || pkg?.name}
                  </p>
                ) : null}
                {((p as { membership_name_snapshot?: string | null }).membership_name_snapshot?.trim()) ? (
                  <p className={`mt-1 text-sm ${ui.muted}`}>
                    Membership: {(p as { membership_name_snapshot?: string | null }).membership_name_snapshot?.trim()}
                  </p>
                ) : null}
                {memberZoneSeries?.title ? (
                  <p className={`mt-1 text-sm ${ui.muted}`}>Member zone series: {memberZoneSeries.title}</p>
                ) : null}
                {memberZoneLesson?.title ? (
                  <p className={`mt-1 text-sm ${ui.muted}`}>Member zone lesson: {memberZoneLesson.title}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!payments?.length ? (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>No orders yet.</p>
            <Link href={studioClassesPath(studioSlug)} className={`mt-1 text-sm ${ui.link}`}>
              Browse classes →
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { studioWhatsappLink } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function MyBookingsPage() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const c = await cookies();
  const activeStudioSlug = normalizeStudioSlug(c.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? "");
  const browseClassesHref = activeStudioSlug ? `/${activeStudioSlug}#upcoming-classes` : "/booking";
  await mergeGuestRecordsForUser(user.id, user.email);

  const { data: bookings } = await supabase
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

  const studioIds = Array.from(new Set((bookings ?? [])
    .map((b) => {
      const session = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
      const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
      return cls?.studio_id ?? null;
    })
    .filter((id): id is string => Boolean(id))));

  const { data: studioRows } =
    studioIds.length > 0
      ? await admin
          .from("studios")
          .select("id, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text")
          .in("id", studioIds)
      : { data: [] as const };
  const studioMap = new Map((studioRows ?? []).map((s) => [s.id, s]));

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-10">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div>
            <h1 className={ui.h1}>My bookings</h1>
            <p className={`mt-1 ${ui.muted}`}>Your booked sessions and attendance status.</p>
          </div>
        </div>

        {/* ── Bookings ─────────────────────────────────────────────── */}
        <section>
          <ul className="mt-4 flex flex-col gap-3">
            {(bookings ?? []).map((b) => {
              const session = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
              const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
              const bookingBadge = getUnifiedStatusBadges({ booking_status: b.status }).booking;
              const isPast = session?.start_time ? new Date(session.start_time) < new Date() : false;
              const dt = session?.start_time ? new Date(session.start_time) : null;
              const timeLabel = dt
                ? dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })
                : null;
              const weekday = dt ? dt.toLocaleDateString("en-SG", { weekday: "short" }) : "";
              const dayNum = dt ? dt.getDate() : "";
              const month = dt ? dt.toLocaleDateString("en-SG", { month: "short" }) : "";
              const studioId = cls?.studio_id ?? null;
              const studio = studioId ? studioMap.get(studioId) : null;
              const singleBadge = bookingBadge;
              const contactText = [
                "Hi front desk, I want to cancel this booking.",
                `Class: ${cls?.title ?? "Class"}`,
                `Time: ${dt ? dt.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" }) : "-"}`,
                `Booking ID: ${b.id}`,
                `Member: ${user.email ?? user.id}`,
              ].join("\n");
              const contactLink = studioWhatsappLink({
                enabled: studio?.whatsapp_enabled,
                numberE164: studio?.whatsapp_number_e164,
                prefillText: contactText,
              });
              return (
                <li key={b.id} className={`${ui.card} ${isPast ? "opacity-70" : ""}`}>
                  <div className="flex items-start gap-3">
                    {/* Calendar block */}
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
                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold text-stone-900 dark:text-stone-100">
                          {cls?.title ?? "Class"}
                        </p>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeToneClass(singleBadge.tone)}`}>
                          {singleBadge.text}
                        </span>
                      </div>
                      {timeLabel ? (
                        <p className={`mt-0.5 text-sm ${ui.muted}`}>{timeLabel}</p>
                      ) : null}
                    </div>
                  </div>
                  {["booked", "pending"].includes(b.status) && !isPast ? (
                    <div className="mt-3 border-t border-stone-100 pt-2.5 dark:border-stone-800">
                      {contactLink ? (
                        <a
                          href={contactLink}
                          target="_blank"
                          rel="noreferrer"
                          className={ui.btnSecondarySm}
                        >
                          Request cancellation
                        </a>
                      ) : (
                        <p className={`text-xs ${ui.muted}`}>
                          Contact front desk to cancel this booking.
                        </p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!bookings?.length ? (
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

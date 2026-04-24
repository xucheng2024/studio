import { redirect } from "next/navigation";
import Link from "next/link";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

const paymentStatusColor: Record<string, string> = {
  paid: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/50",
  pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50",
  failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50",
  expired: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
  refunded: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
};

export default async function MyBookingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
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

  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount, currency, status, created_at, reference_code, payment_method")
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-10">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className={ui.h1}>My bookings</h1>
            <p className={`mt-1 ${ui.muted}`}>Your class bookings and payment history.</p>
          </div>
          <Link href="/checkout" className={`${ui.btnSecondary} shrink-0 self-start`}>
            Buy class passes
          </Link>
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
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeToneClass(bookingBadge.tone)}`}>
                          {bookingBadge.text}
                        </span>
                      </div>
                      {timeLabel ? (
                        <p className={`mt-0.5 text-sm ${ui.muted}`}>{timeLabel}</p>
                      ) : null}
                      {b.payment_status ? (
                        <span className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${paymentStatusColor[b.payment_status] ?? paymentStatusColor.pending}`}>
                          {b.payment_status.charAt(0).toUpperCase() + b.payment_status.slice(1)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {["booked", "pending"].includes(b.status) && !isPast ? (
                    <div className="mt-3 border-t border-stone-100 pt-2.5 dark:border-stone-800">
                      <CancelBookingButton bookingId={b.id} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!bookings?.length ? (
            <div className={`mt-4 ${ui.emptyState}`}>
              <p className={`text-sm ${ui.muted}`}>No bookings yet.</p>
              <Link href="/booking" className={ui.link}>Browse classes →</Link>
            </div>
          ) : null}
        </section>

        {/* ── Payments ─────────────────────────────────────────────── */}
        <section>
          <h2 className={ui.h2}>My payments</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {(payments ?? []).map((p) => (
              <li key={p.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-stone-900 dark:text-stone-100">
                    {p.currency} {Number(p.amount).toFixed(2)}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${paymentStatusColor[p.status ?? ""] ?? paymentStatusColor.pending}`}>
                    {p.status ?? "Unknown"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {p.payment_method ? <span className="capitalize">{p.payment_method}</span> : null}
                  {p.reference_code ? <span>Ref: {p.reference_code}</span> : null}
                  {p.created_at ? (
                    <span>{new Date(p.created_at).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {!payments?.length ? (
            <div className={`mt-4 ${ui.emptyState}`}>
              <p className={`text-sm ${ui.muted}`}>No payments yet.</p>
              <Link href="/booking" className={`mt-1 text-sm ${ui.link}`}>
                Browse classes →
              </Link>
            </div>
          ) : null}
        </section>

      </div>
    </main>
  );
}

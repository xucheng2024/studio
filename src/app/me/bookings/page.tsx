import { redirect } from "next/navigation";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function MyBookingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await mergeGuestRecordsForUser(user.id, user.email);

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      `
      id,
      status,
      payment_status,
      created_at,
      cancelled_at,
      location_id,
      class_sessions (
        start_time,
        classes (
          title,
          studio_id
        )
      )
    `,
    )
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });

  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount, currency, status, created_at, reference_code")
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-4xl space-y-10">
        <section>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className={ui.h1}>My plan</h1>
              <p className={ui.muted}>Bookings, payments, and credits — guest history links by email.</p>
            </div>
            <DashboardAppLink href="/checkout" className={`${ui.btnSecondary} shrink-0 self-start`}>
              Buy packs
            </DashboardAppLink>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {(bookings ?? []).map((b) => {
              const session = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
              const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
              const start = session?.start_time ? new Date(session.start_time).toLocaleString() : "-";
              return (
                <li key={b.id} className={ui.card}>
                  <p className="font-medium text-stone-900 dark:text-stone-100">{cls?.title ?? "Class"}</p>
                  <p className={`mt-1 text-sm ${ui.muted}`}>{start}</p>
                  <p className={`mt-1 text-sm ${ui.muted}`}>
                    Status: {b.status} · Payment: {b.payment_status}
                  </p>
                  <p className={`mt-1 text-xs ${ui.muted}`}>
                    Cancel policy applies by location (cutoff / late-cancel / no-show buffer).
                  </p>
                  {["booked", "pending"].includes(b.status) ? (
                    <div className="mt-2">
                      <CancelBookingButton bookingId={b.id} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!bookings?.length ? <p className={`mt-4 ${ui.muted}`}>No bookings yet.</p> : null}
        </section>

        <section>
          <h2 className={ui.h2}>My payments</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {(payments ?? []).map((p) => (
              <li key={p.id} className={ui.card}>
                <p className="font-medium text-stone-900 dark:text-stone-100">
                  {p.currency} {Number(p.amount).toFixed(2)} · {p.status}
                </p>
                <p className={`mt-1 text-sm ${ui.muted}`}>Ref: {p.reference_code ?? "-"}</p>
                <p className={`mt-1 text-sm ${ui.muted}`}>
                  Created: {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
                </p>
              </li>
            ))}
          </ul>
          {!payments?.length ? <p className={`mt-4 ${ui.muted}`}>No payments yet.</p> : null}
        </section>
      </div>
    </main>
  );
}

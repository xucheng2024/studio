"use client";

import { BulkCheckInButton } from "@/components/BulkCheckInButton";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { CheckInToggleButton } from "@/components/CheckInToggleButton";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { collectPendingPaymentHref } from "@/lib/pending-payment-collect";
import { ui } from "@/lib/ui";

export type StartingSoonSessionGroup = {
  session_id: string;
  class_title: string;
  start_time: string;
  location_name: string | null;
  capacity: number;
  spots_left: number;
  total_booked: number;
  pending_checkin_count: number;
  attendees: Array<{
    booking_id: string;
    label: string;
    guest_email: string | null;
    status: "pending" | "booked" | "attended";
    payment_id?: string | null;
    pos_sale_id?: string | null;
  }>;
};

export function OpsSessionGroup({
  group,
  detailHref,
  studioId,
  locationId,
  onQueueRefresh,
  onWalkIn,
}: {
  group: StartingSoonSessionGroup;
  detailHref: string;
  studioId?: string | null;
  locationId?: string | null;
  onQueueRefresh?: () => void;
  onWalkIn?: (sessionId: string) => void;
}) {
  const attendedCount = group.attendees.filter((attendee) => attendee.status === "attended").length;
  const pendingPaymentCount = group.attendees.filter((attendee) => attendee.status === "pending").length;
  const readyIds = group.attendees
    .filter((attendee) => attendee.status === "booked")
    .map((attendee) => attendee.booking_id);
  const startLabel = group.start_time
    ? `${new Date(group.start_time).toLocaleDateString("en-SG", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })} ${new Date(group.start_time).toLocaleTimeString("en-SG", {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : "—";

  return (
    <section className={ui.card}>
      <div className="flex flex-col gap-2 border-b border-stone-200/80 pb-3 dark:border-stone-800/80 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{group.class_title}</h3>
            <span className={ui.badgeNeutral}>Class</span>
          </div>
          <p className={`text-sm ${ui.muted}`}>{startLabel}</p>
          {group.location_name ? (
            <p className={`text-sm ${ui.muted}`}>{group.location_name}</p>
          ) : null}
          <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
            Booked: {group.total_booked}
            {group.capacity > 0 ? ` / ${group.capacity}` : ""}
            {group.capacity > 0 ? ` · ${group.spots_left} spots left` : ""}
            {" · "}Attended: {attendedCount} · Pending check-in: {group.pending_checkin_count}
            {pendingPaymentCount > 0 ? ` · Pending payment: ${pendingPaymentCount}` : ""}
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <BulkCheckInButton bookingIds={readyIds} onDone={onQueueRefresh} />
          {onWalkIn && group.spots_left > 0 ? (
            <button type="button" className={ui.btnSecondarySm} onClick={() => onWalkIn(group.session_id)}>
              Walk-in
            </button>
          ) : null}
          <DashboardAppLink href={detailHref} className={ui.btnSecondarySm}>
            Open details
          </DashboardAppLink>
        </div>
      </div>

      {group.attendees.length === 0 ? (
        <div className={`mt-3 ${ui.emptyState}`}>
          <p className={ui.muted}>No class bookings yet.</p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {group.attendees.map((attendee) => (
            <li
              key={attendee.booking_id}
              className="rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{attendee.label}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {attendee.guest_email && attendee.guest_email !== attendee.label ? (
                      <p className={`truncate text-xs ${ui.muted}`}>{attendee.guest_email}</p>
                    ) : null}
                    <span
                      className={
                        attendee.status === "attended"
                          ? ui.badge
                          : attendee.status === "booked"
                            ? ui.badgeNeutral
                            : ui.badgeAmber
                      }
                    >
                      {attendee.status === "attended"
                        ? "Checked-in"
                        : attendee.status === "booked"
                          ? "Booked"
                          : "Pending payment"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {attendee.status === "booked" || attendee.status === "attended" ? (
                  <CheckInToggleButton
                    bookingId={attendee.booking_id}
                    status={attendee.status}
                    onDone={onQueueRefresh}
                  />
                ) : (
                  <DashboardAppLink
                    href={collectPendingPaymentHref({
                      studioId,
                      locationId,
                      posSaleId: attendee.pos_sale_id,
                      paymentId: attendee.payment_id,
                      query: attendee.guest_email ?? attendee.label,
                    })}
                    className={ui.btnPrimarySm}
                  >
                    Collect payment
                  </DashboardAppLink>
                )}
                {attendee.status === "booked" ? (
                  <CancelBookingButton
                    bookingId={attendee.booking_id}
                    label={attendee.label}
                    onDone={onQueueRefresh}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

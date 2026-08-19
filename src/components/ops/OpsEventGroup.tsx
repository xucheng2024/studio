"use client";

import { CancelEventBookingButton } from "@/components/CancelEventBookingButton";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { EventCheckInToggleButton } from "@/components/EventCheckInToggleButton";
import {
  opsAttendeeRowClass,
  opsAttendeeSortRank,
  opsCapacitySignal,
  opsUnpaidAttendeeRowClass,
} from "@/lib/ops-board-signals";
import { collectPendingPaymentHref } from "@/lib/pending-payment-collect";
import { ui } from "@/lib/ui";

export type StartingSoonEventGroup = {
  event_id: string;
  event_title: string;
  start_time: string;
  address: string | null;
  capacity: number;
  spots_left: number;
  active_booking_count: number;
  pending_checkin_count: number;
  attendees: Array<{
    event_booking_id: string;
    label: string;
    guest_email: string | null;
    status: "pending" | "booked" | "attended" | "cancelled";
    payment_id?: string | null;
    pos_sale_id?: string | null;
  }>;
};

export function OpsEventGroup({
  group,
  studioId,
  locationId,
  onQueueRefresh,
  onWalkIn,
}: {
  group: StartingSoonEventGroup;
  studioId?: string | null;
  locationId?: string | null;
  onQueueRefresh?: () => void;
  onWalkIn?: (eventId: string) => void;
}) {
  const attendees = [...group.attendees].sort((a, b) => {
    const rank = opsAttendeeSortRank(a.status) - opsAttendeeSortRank(b.status);
    if (rank !== 0) return rank;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
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
  const attendedCount = Math.max(group.active_booking_count - group.pending_checkin_count, 0);
  const pendingPaymentCount = attendees.filter((attendee) => attendee.status === "pending").length;
  const capacitySignal = opsCapacitySignal(group.capacity, group.spots_left);

  return (
    <section className={ui.card}>
      <div className="flex flex-col gap-2 border-b border-stone-200/80 pb-3 dark:border-stone-800/80 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{group.event_title}</h3>
            <span className={ui.badgeAmber}>Event</span>
            {capacitySignal === "full" ? <span className={ui.badgeRed}>Full</span> : null}
            {capacitySignal === "almost_full" ? <span className={ui.badgeAmber}>Almost full</span> : null}
            {pendingPaymentCount > 0 ? (
              <span className={ui.badgeAmber}>
                {pendingPaymentCount} unpaid
              </span>
            ) : null}
          </div>
          <p className={`text-sm ${ui.muted}`}>{startLabel}</p>
          {group.address ? <p className={`text-sm ${ui.muted}`}>{group.address}</p> : null}
          <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
            Booked: {group.active_booking_count}
            {group.capacity > 0 ? ` / ${group.capacity}` : ""}
            {group.capacity > 0 ? ` · ${group.spots_left} spots left` : ""}
            {" · "}Attended: {attendedCount} · Pending check-in: {group.pending_checkin_count}
            {pendingPaymentCount > 0 ? ` · Pending payment: ${pendingPaymentCount}` : ""}
          </p>
        </div>
        {onWalkIn && group.spots_left > 0 ? (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <button type="button" className={ui.btnSecondarySm} onClick={() => onWalkIn(group.event_id)}>
              Walk-in
            </button>
          </div>
        ) : null}
      </div>

      {attendees.length === 0 ? (
        <div className={`mt-3 ${ui.emptyState}`}>
          <p className={ui.muted}>No event bookings yet.</p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {attendees.map((attendee) => (
            <li
              key={attendee.event_booking_id}
              className={attendee.status === "pending" ? opsUnpaidAttendeeRowClass : opsAttendeeRowClass}
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
                            ? ui.badge
                            : attendee.status === "pending"
                              ? ui.badgeAmber
                              : ui.badgeNeutral
                      }
                    >
                      {attendee.status === "attended"
                        ? "Checked-in"
                        : attendee.status === "booked"
                          ? "Booked"
                          : attendee.status === "pending"
                            ? "Pending payment"
                            : "Cancelled"}
                    </span>
                  </div>
                </div>
              </div>
              {attendee.status !== "cancelled" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {attendee.status === "booked" || attendee.status === "attended" ? (
                    <EventCheckInToggleButton
                      eventBookingId={attendee.event_booking_id}
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
                  <CancelEventBookingButton
                    eventBookingId={attendee.event_booking_id}
                    label={attendee.label}
                    status={attendee.status}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

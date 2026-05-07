"use client";

import { CancelEventBookingButton } from "@/components/CancelEventBookingButton";
import { ui } from "@/lib/ui";

export type StartingSoonEventGroup = {
  event_id: string;
  event_title: string;
  start_time: string;
  location_name: string | null;
  active_booking_count: number;
  attendees: Array<{
    event_booking_id: string;
    label: string;
    guest_email: string | null;
    status: "pending" | "booked" | "cancelled";
  }>;
};

export function OpsEventGroup({ group }: { group: StartingSoonEventGroup }) {
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
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{group.event_title}</h3>
            <span className={ui.badgeAmber}>Event</span>
          </div>
          <p className={`text-sm ${ui.muted}`}>{startLabel}</p>
          {group.location_name ? <p className={`text-sm ${ui.muted}`}>{group.location_name}</p> : null}
          <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
            Active bookings: {group.active_booking_count}
          </p>
        </div>
      </div>

      {group.attendees.length === 0 ? (
        <div className={`mt-3 ${ui.emptyState}`}>
          <p className={ui.muted}>No event bookings yet.</p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {group.attendees.map((attendee) => (
            <li
              key={attendee.event_booking_id}
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
                        attendee.status === "booked"
                          ? ui.badge
                          : attendee.status === "pending"
                            ? ui.badgeAmber
                            : ui.badgeNeutral
                      }
                    >
                      {attendee.status === "booked"
                        ? "Booked"
                        : attendee.status === "pending"
                          ? "Pending payment"
                          : "Cancelled"}
                    </span>
                  </div>
                </div>
              </div>
              {attendee.status !== "cancelled" ? (
                <div className="mt-3 flex items-center gap-2">
                  <CancelEventBookingButton eventBookingId={attendee.event_booking_id} label={attendee.label} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

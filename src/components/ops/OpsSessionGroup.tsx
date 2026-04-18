"use client";

import { CheckInApiButton } from "@/components/CheckInApiButton";
import { BulkCheckInButton } from "@/components/ops/BulkCheckInButton";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ui } from "@/lib/ui";

export type StartingSoonSessionGroup = {
  session_id: string;
  class_title: string;
  start_time: string;
  location_name: string | null;
  total_booked: number;
  pending_checkin_count: number;
  attendees: Array<{
    booking_id: string;
    label: string;
    guest_email: string | null;
    status: "booked";
  }>;
};

export function OpsSessionGroup({
  group,
  scheduleHref,
  onCheckInDone,
}: {
  group: StartingSoonSessionGroup;
  scheduleHref: string;
  onCheckInDone: () => void;
}) {
  const startLabel = group.start_time
    ? `${new Date(group.start_time).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })} ${new Date(group.start_time).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : "—";

  return (
    <div className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-2 border-b border-stone-200/80 pb-3 dark:border-stone-800/80 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{group.class_title}</h3>
          <p className={`text-sm ${ui.muted}`}>{startLabel}</p>
          {group.location_name ? (
            <p className={`text-sm ${ui.muted}`}>{group.location_name}</p>
          ) : null}
          <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
            Check-in pending: {group.pending_checkin_count} / {group.total_booked} enrolled
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <BulkCheckInButton
            bookingIds={group.attendees.map((a) => a.booking_id)}
            onDone={onCheckInDone}
          />
          <DashboardAppLink href={scheduleHref} className={ui.btnSecondarySm}>
            Open schedule
          </DashboardAppLink>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {group.attendees.map((a) => (
          <li
            key={a.booking_id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/40"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{a.label}</p>
              {a.guest_email && a.guest_email !== a.label ? (
                <p className={`text-xs ${ui.muted}`}>{a.guest_email}</p>
              ) : null}
            </div>
            <CheckInApiButton bookingId={a.booking_id} onDone={onCheckInDone} />
          </li>
        ))}
      </ul>
    </div>
  );
}

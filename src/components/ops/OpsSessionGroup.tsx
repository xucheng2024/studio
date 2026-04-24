"use client";

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
    status: "booked" | "attended";
  }>;
};

export function OpsSessionGroup({
  group,
  detailHref,
}: {
  group: StartingSoonSessionGroup;
  detailHref: string;
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
    <DashboardAppLink href={detailHref} className={`${ui.card} block transition-shadow hover:shadow-md`}>
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
          <span className={ui.btnSecondarySm}>Open details</span>
        </div>
      </div>
    </DashboardAppLink>
  );
}

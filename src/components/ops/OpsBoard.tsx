"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OpsEventGroup, type StartingSoonEventGroup } from "@/components/ops/OpsEventGroup";
import { OpsSessionGroup, type StartingSoonSessionGroup } from "@/components/ops/OpsSessionGroup";
import { ui } from "@/lib/ui";

type QueuePayload = {
  starting_soon_grouped: StartingSoonSessionGroup[];
  event_groups: StartingSoonEventGroup[];
};

type QueueState = QueuePayload & {
  qs: string | null;
};

export function OpsBoard({
  studioId,
  locationId,
  dateFrom,
  dateTo,
  sessionStatus,
}: {
  studioId: string | null;
  locationId: string | null;
  dateFrom: string;
  dateTo: string;
  sessionStatus: "all" | "scheduled" | "cancelled";
}) {
  const [data, setData] = useState<QueueState>({
    qs: null,
    starting_soon_grouped: [],
    event_groups: [],
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (studioId) p.set("studio_id", studioId);
    if (locationId) p.set("location_id", locationId);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (sessionStatus) p.set("session_status", sessionStatus);
    return p.toString();
  }, [studioId, locationId, dateFrom, dateTo, sessionStatus]);

  const loadQueue = useCallback(() => {
    const controller = new AbortController();
    fetch(`/api/operations/queue?${qs}`, { cache: "no-store", signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        setData({
          qs,
          starting_soon_grouped: json.starting_soon_grouped ?? [],
          event_groups: json.event_groups ?? [],
        });
      })
      .catch(() => null);
    return controller;
  }, [qs]);

  useEffect(() => {
    const controller = loadQueue();
    return () => {
      controller.abort();
    };
  }, [qs, loadQueue]);

  const loading = data.qs !== qs;

  if (loading) {
    return (
      <div className="grid gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={`${ui.card} animate-pulse`}>
            <div className="h-5 w-48 rounded bg-stone-200 dark:bg-stone-700" />
            <div className="mt-3 h-4 w-full rounded bg-stone-100 dark:bg-stone-800" />
            <div className="mt-2 h-4 w-2/3 rounded bg-stone-100 dark:bg-stone-800" />
          </div>
        ))}
      </div>
    );
  }

  if (!data.starting_soon_grouped.length && !data.event_groups.length) {
    return (
      <section className={ui.card}>
        <p className={ui.muted}>No bookings match this filter.</p>
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      {data.starting_soon_grouped.length ? (
        <section className="grid gap-4">
          <div>
            <h2 className={ui.h2}>Class sessions</h2>
            <p className={ui.muted}>Check-ins and attendee actions for scheduled classes.</p>
          </div>
          {data.starting_soon_grouped.map((group) => (
            <OpsSessionGroup
              key={group.session_id}
              group={group}
              detailHref={`/dashboard/sessions/${group.session_id}/checkin?${qs}`}
            />
          ))}
        </section>
      ) : null}
      {data.event_groups.length ? (
        <section className="grid gap-4">
          <div>
            <h2 className={ui.h2}>Event bookings</h2>
            <p className={ui.muted}>Check-in event attendees here. Refunds still stay in Payments.</p>
          </div>
          {data.event_groups.map((group) => (
            <OpsEventGroup key={group.event_id} group={group} onQueueRefresh={loadQueue} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

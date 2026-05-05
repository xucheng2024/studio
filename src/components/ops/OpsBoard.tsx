"use client";

import { useEffect, useMemo, useState } from "react";
import { OpsSessionGroup, type StartingSoonSessionGroup } from "@/components/ops/OpsSessionGroup";
import { ui } from "@/lib/ui";

type QueuePayload = {
  starting_soon_grouped: StartingSoonSessionGroup[];
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

  useEffect(() => {
    let mounted = true;
    fetch(`/api/operations/queue?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!mounted) return;
        setData({
          qs,
          starting_soon_grouped: json.starting_soon_grouped ?? [],
        });
      });
    return () => {
      mounted = false;
    };
  }, [qs]);

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

  if (!data.starting_soon_grouped.length) {
    return (
      <section className={ui.card}>
        <p className={ui.muted}>No sessions match this filter.</p>
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      {data.starting_soon_grouped.map((group) => (
        <OpsSessionGroup
          key={group.session_id}
          group={group}
          detailHref={`/dashboard/sessions/${group.session_id}/checkin?${qs}`}
        />
      ))}
    </div>
  );
}

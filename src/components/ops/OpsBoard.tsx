"use client";

import { useEffect, useMemo, useState } from "react";
import { OpsItemRow } from "@/components/ops/OpsItemRow";
import { OpsSection } from "@/components/ops/OpsSection";
import { OpsSessionGroup, type StartingSoonSessionGroup } from "@/components/ops/OpsSessionGroup";
import { ui } from "@/lib/ui";

type QueueItem = {
  id: string;
  type: string;
  primary_label: string;
  secondary_label: string;
  booking_status?: string | null;
  payment_status?: string | null;
  recon_status?: string | null;
  exception_code?: string | null;
  wait_minutes?: number;
  sla_overdue?: boolean;
  actions: Array<
    | { kind: "mark_paid" | "mark_failed" | "mark_expired"; label: string; payment_id: string }
    | { kind: "checkin"; label: string; booking_id: string }
    | { kind: "approve" | "reject" | "open_match" | "more_link"; label: string; href: string }
  >;
};

type QueuePayload = {
  pending_verifications: QueueItem[];
  starting_soon: QueueItem[];
  starting_soon_grouped: StartingSoonSessionGroup[];
};

function toBusinessCopy(text: string) {
  return text.replace("verification_sla_overdue", "confirmation overdue");
}

export function OpsBoard({
  studioId,
  locationId,
  dateFrom,
  dateTo,
  status,
  q,
}: {
  studioId: string | null;
  locationId: string | null;
  dateFrom: string;
  dateTo: string;
  status: string;
  q: string;
}) {
  const [loading, setLoading] = useState(true);
  const [refreshingSection, setRefreshingSection] = useState<string | null>(null);
  const [data, setData] = useState<QueuePayload>({
    pending_verifications: [],
    starting_soon: [],
    starting_soon_grouped: [],
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (studioId) p.set("studio_id", studioId);
    if (locationId) p.set("location_id", locationId);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    return p.toString();
  }, [studioId, locationId, dateFrom, dateTo, status, q]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/operations/queue?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!mounted) return;
        setData({
          pending_verifications: json.pending_verifications ?? [],
          starting_soon: json.starting_soon ?? [],
          starting_soon_grouped: json.starting_soon_grouped ?? [],
        });
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [qs]);

  const refreshSection = async (
    section: "pending_verifications" | "starting_soon",
  ) => {
    setRefreshingSection(section);
    const json = await fetch(`/api/operations/queue?${qs}`, { cache: "no-store" }).then((r) => r.json());
    setData((prev) => ({
      ...prev,
      [section]: json?.[section] ?? [],
      ...(section === "starting_soon"
        ? { starting_soon_grouped: json?.starting_soon_grouped ?? [] }
        : {}),
    }));
    setRefreshingSection(null);
  };

  if (loading) {
    return (
      <div className="grid gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${ui.card} animate-pulse`}>
            <div className="h-5 w-48 rounded bg-stone-200 dark:bg-stone-700" />
            <div className="mt-3 h-4 w-full rounded bg-stone-100 dark:bg-stone-800" />
            <div className="mt-2 h-4 w-2/3 rounded bg-stone-100 dark:bg-stone-800" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <OpsSection
        title="Pending Transfers"
        description="All pending transfers in one queue; overdue items are highlighted."
        emptyText="No pending transfers."
      >
        {data.pending_verifications.length ? (
          <div className="grid gap-2">
            {data.pending_verifications.map((item) => (
              <OpsItemRow
                key={item.id}
                primary={item.primary_label}
                secondary={toBusinessCopy(item.secondary_label)}
                paymentStatus={item.payment_status ?? "pending"}
                reconStatus={item.recon_status ?? null}
                exceptionCode={item.exception_code ?? null}
                waitMinutes={item.wait_minutes}
                overdue={item.sla_overdue}
                actions={item.actions}
                sectionKey="pending_verifications"
                onActionDone={refreshSection}
              />
            ))}
          </div>
        ) : null}
        {refreshingSection === "pending_verifications" ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>Refreshing section...</p>
        ) : null}
      </OpsSection>

      <OpsSection
        title="Classes Starting Soon"
        description="Classes in the next 30 minutes that still need check-in."
        emptyText="No upcoming check-in tasks."
      >
        {data.starting_soon_grouped.length ? (
          <div className="grid gap-4">
            {data.starting_soon_grouped.map((group) => (
              <OpsSessionGroup
                key={group.session_id}
                group={group}
                scheduleHref={`/dashboard/schedule?${qs}`}
                onCheckInDone={() => void refreshSection("starting_soon")}
              />
            ))}
          </div>
        ) : null}
        {refreshingSection === "starting_soon" ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>Refreshing section...</p>
        ) : null}
      </OpsSection>

      {/* Exception section intentionally removed.
          Re-enable only after bank-reconciliation data can produce high-signal exceptions. */}
    </div>
  );
}

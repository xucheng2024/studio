"use client";

import { useEffect, useMemo, useState } from "react";
import { OpsItemRow } from "@/components/ops/OpsItemRow";
import { OpsSection } from "@/components/ops/OpsSection";
import { ui } from "@/lib/ui";

type QueueItem = {
  id: string;
  type: string;
  primary_label: string;
  secondary_label: string;
  booking_status?: string | null;
  payment_status?: string | null;
  recon_status?: string | null;
  actions: Array<
    | { kind: "mark_paid" | "mark_failed" | "mark_expired"; label: string; payment_id: string }
    | { kind: "checkin"; label: string; booking_id: string }
    | { kind: "approve" | "reject" | "open_match" | "more_link"; label: string; href: string }
  >;
};

type QueuePayload = {
  pending_verifications: QueueItem[];
  payment_exceptions: QueueItem[];
  starting_soon: QueueItem[];
  unmatched_payments: QueueItem[];
};

function toBusinessCopy(text: string) {
  return text
    .replace("Recon ", "Review ")
    .replace("amount_mismatch", "amount mismatch")
    .replace("missing_reference", "missing transfer reference")
    .replace("verification_sla_overdue", "confirmation overdue")
    .replace("needs_review", "needs manual review")
    .replace("No booking attached", "No booking linked yet");
}

export function OpsBoard({
  studioId,
  locationId,
  dateFrom,
  dateTo,
  status,
  reconStatus,
  q,
}: {
  studioId: string | null;
  locationId: string | null;
  dateFrom: string;
  dateTo: string;
  status: string;
  reconStatus: string;
  q: string;
}) {
  const [loading, setLoading] = useState(true);
  const [refreshingSection, setRefreshingSection] = useState<string | null>(null);
  const [data, setData] = useState<QueuePayload>({
    pending_verifications: [],
    payment_exceptions: [],
    starting_soon: [],
    unmatched_payments: [],
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (studioId) p.set("studio_id", studioId);
    if (locationId) p.set("location_id", locationId);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (status) p.set("status", status);
    if (reconStatus) p.set("recon_status", reconStatus);
    if (q) p.set("q", q);
    return p.toString();
  }, [studioId, locationId, dateFrom, dateTo, status, reconStatus, q]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/operations/queue?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!mounted) return;
        setData({
          pending_verifications: json.pending_verifications ?? [],
          payment_exceptions: json.payment_exceptions ?? [],
          starting_soon: json.starting_soon ?? [],
          unmatched_payments: json.unmatched_payments ?? [],
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
    section: "pending_verifications" | "starting_soon" | "payment_exceptions" | "unmatched_payments",
  ) => {
    setRefreshingSection(section);
    const json = await fetch(`/api/operations/queue?${qs}`, { cache: "no-store" }).then((r) => r.json());
    setData((prev) => ({
      ...prev,
      [section]: json?.[section] ?? [],
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
        description="Customer-submitted transfers waiting for staff confirmation."
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
        description="Upcoming classes in the next 30 minutes that still need check-in."
        emptyText="No upcoming check-in tasks."
      >
        {data.starting_soon.length ? (
          <div className="grid gap-2">
            {data.starting_soon.map((item) => (
              <OpsItemRow
                key={item.id}
                primary={item.primary_label}
                secondary={toBusinessCopy(item.secondary_label)}
                bookingStatus={item.booking_status ?? "booked"}
                actions={item.actions}
                sectionKey="starting_soon"
                onActionDone={refreshSection}
              />
            ))}
          </div>
        ) : null}
        {refreshingSection === "starting_soon" ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>Refreshing section...</p>
        ) : null}
      </OpsSection>

      <OpsSection
        title="Payments To Review"
        description="Transfers with mismatch, missing reference, or manual review flags."
        emptyText="No payments to review."
      >
        {data.payment_exceptions.length ? (
          <div className="grid gap-2">
            {data.payment_exceptions.map((item) => (
              <OpsItemRow
                key={item.id}
                primary={item.primary_label}
                secondary={toBusinessCopy(item.secondary_label)}
                reconStatus={item.recon_status ?? "manual_review"}
                actions={item.actions}
                sectionKey="payment_exceptions"
                onActionDone={refreshSection}
              />
            ))}
          </div>
        ) : null}
        {refreshingSection === "payment_exceptions" ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>Refreshing section...</p>
        ) : null}
      </OpsSection>

      <OpsSection
        title="Payments Without Booking"
        description="Payments received but not yet linked to a booking."
        emptyText="No unmatched payments."
      >
        {data.unmatched_payments.length ? (
          <div className="grid gap-2">
            {data.unmatched_payments.map((item) => (
              <OpsItemRow
                key={item.id}
                primary={item.primary_label}
                secondary={toBusinessCopy(item.secondary_label)}
                paymentStatus={item.payment_status ?? null}
                reconStatus={item.recon_status ?? null}
                actions={item.actions}
                sectionKey="unmatched_payments"
                onActionDone={refreshSection}
              />
            ))}
          </div>
        ) : null}
        {refreshingSection === "unmatched_payments" ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>Refreshing section...</p>
        ) : null}
      </OpsSection>
    </div>
  );
}

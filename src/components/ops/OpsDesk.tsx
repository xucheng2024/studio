"use client";

import { useState, type ReactNode } from "react";
import { FrontdeskWalkinForm, type WalkinCustomerOption, type WalkinPrefillRequest, type WalkinTarget } from "@/components/FrontdeskWalkinForm";
import { OpsBoard } from "@/components/ops/OpsBoard";

export function OpsDesk({
  studioId,
  locationId,
  dateFrom,
  dateTo,
  sessionStatus,
  sessions,
  events,
  customers,
  posHref,
  disabled = false,
  children,
}: {
  studioId: string | null;
  locationId: string | null;
  dateFrom: string;
  dateTo: string;
  sessionStatus: "all" | "scheduled" | "cancelled";
  sessions: WalkinTarget[];
  events: WalkinTarget[];
  customers: WalkinCustomerOption[];
  posHref?: string | null;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const [prefill, setPrefill] = useState<WalkinPrefillRequest | null>(null);
  const [queueEpoch, setQueueEpoch] = useState(0);

  return (
    <>
      <OpsBoard
        studioId={studioId}
        locationId={locationId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        sessionStatus={sessionStatus}
        queueEpoch={queueEpoch}
        onWalkIn={(kind, targetId) => {
          setPrefill({ bookingType: kind, targetId, nonce: Date.now() });
        }}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] xl:items-start">
        <FrontdeskWalkinForm
          sessions={sessions}
          events={events}
          customers={customers}
          posHref={posHref}
          disabled={disabled}
          prefill={prefill}
          onCreated={() => setQueueEpoch((value) => value + 1)}
        />
        {children}
      </div>
    </>
  );
}

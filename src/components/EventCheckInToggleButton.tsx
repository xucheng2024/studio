"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { toast } from "sonner";
import { eventBookingErrorMessage } from "@/lib/eventBookingErrors";
import { ui } from "@/lib/ui";

export function EventCheckInToggleButton({
  eventBookingId,
  status,
  onDone,
}: {
  eventBookingId: string;
  status: "booked" | "attended";
  onDone?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isAttended = status === "attended";
  return (
    <button
      type="button"
      disabled={loading}
      className={`${isAttended ? ui.btnSecondarySm : ui.btnPrimarySm} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        const res = await fetch(isAttended ? "/api/event-checkin/uncheck" : "/api/event-checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_booking_id: eventBookingId }),
        });
        setLoading(false);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(
            eventBookingErrorMessage(String(body.error ?? "")) ||
              (isAttended ? "Could not undo check-in" : "Check-in failed"),
          );
          return;
        }
        toast.success(isAttended ? "Marked as not checked-in" : "Checked in");
        if (onDone) onDone();
        else throttledRefresh(router);
      }}
    >
      {loading ? "…" : isAttended ? "Undo check-in" : "Check in"}
    </button>
  );
}

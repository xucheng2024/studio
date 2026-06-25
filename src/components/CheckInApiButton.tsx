"use client";

import { useRouter } from "next/navigation";
import { sessionCheckinErrorMessage } from "@/lib/sessionErrors";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

export function CheckInApiButton({ bookingId, onDone }: { bookingId: string; onDone?: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      disabled={loading}
      className={`${ui.btnSecondarySm} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_id: bookingId }),
        });
        setLoading(false);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(sessionCheckinErrorMessage(typeof body.error === "string" ? body.error : null));
          return;
        }
        toast.success("Checked in");
        if (onDone) onDone();
        else throttledRefresh(router);
      }}
    >
      {loading ? "…" : "Check-in"}
    </button>
  );
}

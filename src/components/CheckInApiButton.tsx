"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function CheckInApiButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      disabled={loading}
      className={`text-xs ${ui.linkMuted} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_id: bookingId }),
        });
        setLoading(false);
        router.refresh();
      }}
    >
      {loading ? "…" : "Check-in"}
    </button>
  );
}

"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

export function BulkCheckInButton({
  bookingIds,
  onDone,
}: {
  bookingIds: string[];
  onDone?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  if (!bookingIds.length) return null;

  return (
    <button
      type="button"
      className={ui.btnSecondarySm}
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await fetch("/api/checkin/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_ids: bookingIds }),
        });
        setLoading(false);
        onDone?.();
      }}
    >
      {loading ? "Checking in..." : `Check in all (${bookingIds.length})`}
    </button>
  );
}


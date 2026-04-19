"use client";

import { useState } from "react";
import { toast } from "sonner";
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
        const res = await fetch("/api/checkin/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_ids: bookingIds }),
        });
        const body = await res.json().catch(() => ({}));
        setLoading(false);
        if (!res.ok) {
          toast.error(body.error ?? "Bulk check-in failed");
        } else {
          const okCount = (body.results ?? []).filter((r: { ok?: boolean }) => r.ok).length;
          toast.success(`Checked in ${okCount} of ${bookingIds.length}`);
        }
        onDone?.();
      }}
    >
      {loading ? "Checking in..." : `Check in all (${bookingIds.length})`}
    </button>
  );
}


"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type BulkResult = { booking_id: string; ok: boolean; error?: string };

export function BulkCheckInButton({
  bookingIds,
  onDone,
}: {
  bookingIds: string[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  if (bookingIds.length <= 1) return null;

  return (
    <button
      type="button"
      disabled={loading}
      className={`${ui.btnPrimarySm} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        const res = await fetch("/api/checkin/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_ids: bookingIds }),
        });
        const body = await res.json().catch(() => ({}));
        setLoading(false);
        const results = Array.isArray(body.results) ? (body.results as BulkResult[]) : [];
        const failed = results.filter((row) => !row.ok);
        if (!res.ok) {
          console.log("bulk check-in failed", { status: res.status, body, booking_ids: bookingIds });
          toast.error(typeof body.error === "string" ? body.error : "Check-in all failed");
          return;
        }
        if (failed.length) {
          console.log("bulk check-in partial", { failed, booking_ids: bookingIds });
          toast.error(`Checked in ${results.length - failed.length} of ${bookingIds.length}`);
        } else {
          toast.success(`Checked in ${bookingIds.length}`);
        }
        if (onDone) onDone();
        else throttledRefresh(router);
      }}
    >
      {loading ? "…" : "Check in all ready"}
    </button>
  );
}

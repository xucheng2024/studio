"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAttended } from "@/app/dashboard/actions";
import { ui } from "@/lib/ui";

export function MarkAttendedButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      className={`text-xs ${ui.linkMuted} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        await markAttended(bookingId);
        setLoading(false);
        router.refresh();
      }}
    >
      {loading ? "…" : "Mark attended"}
    </button>
  );
}

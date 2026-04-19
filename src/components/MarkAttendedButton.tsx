"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserCheck, Loader2 } from "lucide-react";
import { markAttended } from "@/app/dashboard/actions";
import { ui } from "@/lib/ui";

export function MarkAttendedButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      className={`inline-flex items-center gap-1 text-xs ${ui.linkMuted} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        await markAttended(bookingId);
        setLoading(false);
        router.refresh();
      }}
    >
      {loading ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <UserCheck size={11} />
      )}
      {loading ? "Marking…" : "Mark attended"}
    </button>
  );
}

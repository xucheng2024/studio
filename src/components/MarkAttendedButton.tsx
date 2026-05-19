"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { UserCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { markAttended } from "@/app/(app)/dashboard/actions";
import { ui } from "@/lib/ui";

export function MarkAttendedButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      className={`${ui.btnSecondarySm} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        await markAttended(bookingId);
        setLoading(false);
        toast.success("Marked as attended");
        throttledRefresh(router);
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

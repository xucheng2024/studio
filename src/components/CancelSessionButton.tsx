"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function CancelSessionButton({
  sessionId,
  classTitle,
  startTimeIso,
  locationName,
  sessionStatus,
}: {
  sessionId: string;
  classTitle: string;
  startTimeIso: string;
  locationName: string | null;
  sessionStatus: string | null | undefined;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const scheduled = (sessionStatus ?? "scheduled") === "scheduled";
  if (!scheduled) return null;

  return (
    <div className="mt-2 flex max-w-sm flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={`${ui.label} text-xs`}>Cancel reason (optional)</span>
        <textarea
          className={`${ui.input} min-h-11 resize-y text-sm`}
          rows={2}
          maxLength={500}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Shown in studio records; optional note for refunds"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        className="inline-flex w-fit items-center justify-center rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-900 shadow-sm hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/60"
        onClick={async () => {
          const ok = window.confirm(
            `Cancel this entire session?\n\n${classTitle}\n${new Date(startTimeIso).toLocaleString()}${locationName ? `\n${locationName}` : ""}\n\nAll pending and booked reservations will be cancelled. Refunds and credits run automatically where applicable.`,
          );
          if (!ok) return;
          setBusy(true);
          const res = await fetch("/api/session/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              reason: reason.trim() || undefined,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setBusy(false);
          if (!res.ok) {
            window.alert(data.error ? String(data.error) : "Cancel failed");
            return;
          }
          const affected = Number(data.affected_bookings ?? 0);
          const refunds = Number(data.payments_refunded_count ?? 0);
          const credits = Number(data.credits_returned_count ?? 0);
          const idem = data.already_cancelled === true;
          window.alert(
            idem
              ? "This session was already cancelled (no further changes)."
              : `Session cancelled.\n\nBookings affected: ${affected}\nPayments refunded: ${refunds}\nCredits returned: ${credits}`,
          );
          setReason("");
          router.refresh();
        }}
      >
        {busy ? "…" : "Cancel session"}
      </button>
    </div>
  );
}

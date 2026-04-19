"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type Attendee = {
  id: string;
  label: string;
  status: string;
};

export function BulkCheckinPanel({
  sessionLabel,
  attendees,
}: {
  sessionLabel: string;
  attendees: Attendee[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const checkableAttendees = attendees.filter((a) => a.status === "booked");

  return (
    <div className={ui.card}>
      <p className="font-medium text-stone-900 dark:text-stone-100">{sessionLabel}</p>
      <div className="mt-3 space-y-1.5">
        {attendees.map((a) => {
          const isCheckable = a.status === "booked";
          const isSelected = selected.includes(a.id);
          return (
            <label
              key={a.id}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                isCheckable
                  ? "cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50"
                  : "opacity-50"
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(a.id)}
                disabled={!isCheckable || busy}
                className="h-4 w-4 cursor-pointer accent-teal-500 disabled:cursor-not-allowed"
              />
              <span className="flex-1 text-stone-800 dark:text-stone-200">{a.label}</span>
              {a.status !== "booked" && (
                <span className={`text-xs ${ui.muted}`}>{a.status}</span>
              )}
            </label>
          );
        })}
      </div>

      {checkableAttendees.length > 1 && (
        <button
          type="button"
          className={`mt-2 text-xs ${ui.linkMuted}`}
          onClick={() =>
            setSelected(
              selected.length === checkableAttendees.length
                ? []
                : checkableAttendees.map((a) => a.id),
            )
          }
        >
          {selected.length === checkableAttendees.length ? "Deselect all" : "Select all"}
        </button>
      )}

      <button
        type="button"
        className={`${ui.btnPrimary} mt-3`}
        disabled={selected.length === 0 || busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/checkin/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ booking_ids: selected }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            toast.error(body.error ?? "Bulk check-in failed");
            return;
          }
          const okCount = (body.results ?? []).filter((r: { ok?: boolean }) => r.ok).length;
          toast.success(`Checked in ${okCount} of ${selected.length}`);
          setSelected([]);
        }}
      >
        {busy ? "Checking in…" : `Check in ${selected.length > 0 ? `(${selected.length})` : ""}`}
      </button>
    </div>
  );
}

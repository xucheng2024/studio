"use client";

import { useState } from "react";
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
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className={ui.card}>
      <p className="font-medium text-stone-900 dark:text-stone-100">{sessionLabel}</p>
      <div className="mt-2 space-y-1">
        {attendees.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(a.id)}
              onChange={() => toggle(a.id)}
              disabled={a.status !== "booked"}
            />
            <span>{a.label}</span>
            <span className={ui.muted}>({a.status})</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className={`${ui.btnSecondary} mt-3`}
        disabled={selected.length === 0}
        onClick={async () => {
          setMsg(null);
          const res = await fetch("/api/checkin/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ booking_ids: selected }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            setMsg(body.error ?? "bulk_checkin_failed");
            return;
          }
          const okCount = (body.results ?? []).filter((r: { ok?: boolean }) => r.ok).length;
          setMsg(`Checked in ${okCount}/${selected.length}`);
          setSelected([]);
        }}
      >
        Bulk check-in
      </button>
      {msg ? <p className={`mt-2 text-xs ${ui.muted}`}>{msg}</p> : null}
    </div>
  );
}

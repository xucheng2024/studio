"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, CheckCircle2, Pencil, AlertCircle } from "lucide-react";
import { ui } from "@/lib/ui";

type LocationOption = { id: string; name: string };

export function SessionEditPanel({
  sessionId,
  initial,
  locations,
}: {
  sessionId: string;
  initial: {
    start_time: string;
    capacity: number;
    guest_price: number;
    credits_required: number;
    location_id: string | null;
  };
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(initial.start_time);
    const tzOffsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  });
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [guestPrice, setGuestPrice] = useState(String(initial.guest_price));
  const [creditsRequired, setCreditsRequired] = useState(String(initial.credits_required));
  const [locationId, setLocationId] = useState(initial.location_id ?? "");

  return (
    <details className="chevron rounded-lg border border-stone-200 p-3 dark:border-stone-700">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300">
        <Pencil size={12} />
        Edit session
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={ui.label}>Start time</span>
          <input
            type="datetime-local"
            className={ui.input}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Capacity</span>
          <input className={ui.input} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Guest price</span>
          <input className={ui.input} type="number" min={0} step="0.01" value={guestPrice} onChange={(e) => setGuestPrice(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Credits required</span>
          <input className={ui.input} type="number" min={1} step="1" value={creditsRequired} onChange={(e) => setCreditsRequired(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Location</span>
          <select className={ui.select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Unassigned</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`${ui.btnPrimarySm} w-fit sm:col-span-2`}
          disabled={busy}
          onClick={async () => {
            const parsedCapacity = Number(capacity);
            const parsedGuestPrice = Number(guestPrice);
            const parsedCredits = Number(creditsRequired);
            if (!Number.isFinite(parsedCapacity) || parsedCapacity < 1) {
              setMsg("Capacity must be a positive number");
              return;
            }
            if (!Number.isFinite(parsedGuestPrice) || parsedGuestPrice < 0) {
              setMsg("Guest price must be 0 or greater");
              return;
            }
            if (!Number.isFinite(parsedCredits) || parsedCredits < 1) {
              setMsg("Credits required must be a positive number");
              return;
            }
            setBusy(true);
            setMsg(null);
            const local = new Date(startTime);
            const res = await fetch(`/api/dashboard/sessions/${sessionId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                start_time: local.toISOString(),
                capacity: parsedCapacity,
                guest_price: parsedGuestPrice,
                credits_required: parsedCredits,
                location_id: locationId || null,
              }),
            });
            const body = await res.json().catch(() => ({}));
            setBusy(false);
            if (!res.ok) {
              setMsg(body.error ?? "save_failed");
              return;
            }
            setMsg("Saved");
            router.refresh();
          }}
        >
          <Check size={13} />
          {busy ? "Saving…" : "Save session"}
        </button>
        {msg ? (
          <p className={`flex items-center gap-1.5 text-xs sm:col-span-2 ${
            msg === "Saved" ? "text-teal-700 dark:text-teal-400" : "text-red-600 dark:text-red-400"
          }`}>
            {msg === "Saved" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {msg}
          </p>
        ) : null}
      </div>
    </details>
  );
}

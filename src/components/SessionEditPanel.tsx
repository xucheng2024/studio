"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { Check, Pencil, AlertCircle } from "lucide-react";
import { toast } from "sonner";
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
    guest_price: number | null;
    credits_required: number;
    location_id: string | null;
    address: string | null;
    address_details: string | null;
  };
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(initial.start_time);
    const tzOffsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  });
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [guestPrice, setGuestPrice] = useState(initial.guest_price != null ? String(initial.guest_price) : "");
  const [creditsRequired, setCreditsRequired] = useState(String(initial.credits_required));
  const [locationId, setLocationId] = useState(initial.location_id ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [addressDetails, setAddressDetails] = useState(initial.address_details ?? "");

  return (
    <details className="chevron rounded-lg border border-stone-200 p-3 dark:border-stone-700">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300">
        <Pencil size={12} />
        Edit session details
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
          <span className={ui.label}>Guest price (SGD)</span>
          <input className={ui.input} type="number" min={0} step="0.01" value={guestPrice} onChange={(e) => setGuestPrice(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Passes required</span>
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
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={ui.label}>Session address</span>
          <input
            className={ui.input}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address (optional)"
            autoComplete="street-address"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={ui.label}>Venue details</span>
          <textarea
            className={`${ui.input} min-h-16`}
            value={addressDetails}
            onChange={(e) => setAddressDetails(e.target.value)}
            placeholder="Floor, room, instructions (optional)"
            rows={2}
          />
        </label>
        <button
          type="button"
          className={`${ui.btnPrimarySm} w-fit sm:col-span-2`}
          disabled={busy}
          onClick={async () => {
            const parsedCapacity = Number(capacity);
            const guestPriceRaw = guestPrice.trim();
            const parsedGuestPrice = guestPriceRaw === "" ? null : Number(guestPriceRaw);
            const parsedCredits = Number(creditsRequired);
            if (!Number.isFinite(parsedCapacity) || parsedCapacity < 1) {
              setValidationMsg("Capacity must be a positive number");
              return;
            }
            if (parsedGuestPrice != null && (!Number.isFinite(parsedGuestPrice) || parsedGuestPrice < 0)) {
              setValidationMsg("Guest price must be 0 or greater");
              return;
            }
            if (!Number.isFinite(parsedCredits) || parsedCredits < 1) {
              setValidationMsg("Passes required must be a positive number");
              return;
            }
            setBusy(true);
            setValidationMsg(null);
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
                address: address.trim() || null,
                address_details: addressDetails.trim() || null,
              }),
            });
            const body = await res.json().catch(() => ({}));
            setBusy(false);
            if (!res.ok) {
              toast.error(body.error ?? "Save failed");
              return;
            }
            toast.success("Session saved");
            throttledRefresh(router);
          }}
        >
          <Check size={13} />
          {busy ? "Saving…" : "Save session changes"}
        </button>
        {validationMsg ? (
          <p className="flex items-center gap-1.5 text-xs text-red-600 sm:col-span-2 dark:text-red-400">
            <AlertCircle size={12} />
            {validationMsg}
          </p>
        ) : null}
      </div>
    </details>
  );
}

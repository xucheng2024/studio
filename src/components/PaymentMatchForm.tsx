"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function PaymentMatchForm({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [bookingId, setBookingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={bookingId}
        onChange={(e) => setBookingId(e.target.value)}
        placeholder="booking uuid"
        className={`${ui.input} h-8 w-56 py-1 text-xs`}
      />
      <button
        type="button"
        className={ui.btnSecondarySm}
        disabled={busy || !bookingId}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/payment/match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment_id: paymentId, booking_id: bookingId }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            setMsg(body.error ?? "match_failed");
            return;
          }
          setMsg("Matched");
          setBookingId("");
          router.refresh();
        }}
      >
        {busy ? "..." : "Manual match"}
      </button>
      {msg ? <span className={`text-xs ${ui.muted}`}>{msg}</span> : null}
    </div>
  );
}

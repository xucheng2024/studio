"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

export function PaymentMatchForm({ paymentId, onDone }: { paymentId: string; onDone?: () => void }) {
  const router = useRouter();
  const [bookingId, setBookingId] = useState("");
  const [busy, setBusy] = useState(false);

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
          const res = await fetch("/api/payment/match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment_id: paymentId, booking_id: bookingId }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            toast.error(body.error ?? "Match failed");
            return;
          }
          toast.success("Payment matched");
          setBookingId("");
          if (onDone) onDone();
          else router.refresh();
        }}
      >
        {busy ? "…" : "Manual match"}
      </button>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function BookButton({
  sessionId,
  disabled = false,
}: {
  sessionId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please pick another time.";
    if (code === "active_booking_limit_exceeded") return "You already have several active bookings.";
    if (code === "late_cancel_limit_exceeded") return "Please contact frontdesk before booking again.";
    if (code === "PAYNOW_NOT_CONFIGURED") return "PayNow is not configured for this studio yet.";
    return "Could not create booking. Please try again.";
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={loading || disabled}
        className={`${ui.btnPrimarySm} disabled:opacity-50`}
        onClick={async () => {
          setLoading(true);
          setMessage(null);
          const res = await fetch("/api/book/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
          const body = await res.json().catch(() => ({}));
          setLoading(false);
          if (!res.ok) {
            setMessage(toFriendly(String(body.error ?? "")));
            return;
          }
          if (body.checkout_url) {
            router.push(body.checkout_url);
            return;
          }
          setMessage("Reservation created. Continue to payment.");
        }}
      >
        {loading ? "Creating..." : disabled ? "PayNow unavailable" : "Book"}
      </button>
      {message ? <span className={`text-xs ${ui.muted}`}>{message}</span> : null}
    </div>
  );
}

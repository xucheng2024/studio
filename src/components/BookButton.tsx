"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreditCard, Loader2, AlertCircle } from "lucide-react";
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
  const [isError, setIsError] = useState(false);

  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please pick another time.";
    if (code === "active_booking_limit_exceeded") return "You already have several active bookings.";
    if (code === "late_cancel_limit_exceeded") return "Please contact front desk before booking again.";
    if (code === "PAYNOW_NOT_CONFIGURED") return "PayNow is not configured for this studio yet.";
    return "Could not create booking. Please try again.";
  };

  if (disabled) return null;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={loading}
        className={`${ui.btnSecondarySm} disabled:opacity-50`}
        onClick={async () => {
          setLoading(true);
          setMessage(null);
          setIsError(false);
          const res = await fetch("/api/book/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
          const body = await res.json().catch(() => ({}));
          setLoading(false);
          if (!res.ok) {
            setMessage(toFriendly(String(body.error ?? "")));
            setIsError(true);
            return;
          }
          if (body.checkout_url) {
            router.push(body.checkout_url);
            return;
          }
          setMessage("Reservation created. Proceeding to payment…");
        }}
      >
        {loading ? (
          <><Loader2 size={12} className="animate-spin" /> Processing…</>
        ) : (
          <><CreditCard size={12} /> Pay by transfer</>
        )}
      </button>
      {message ? (
        <span className={`flex items-center gap-1 text-xs ${
          isError ? "text-red-600 dark:text-red-400" : ui.muted
        }`}>
          {isError ? <AlertCircle size={11} /> : null}
          {message}
        </span>
      ) : null}
    </div>
  );
}

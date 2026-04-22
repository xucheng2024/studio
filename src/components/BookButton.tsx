"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
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

  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please pick another time.";
    if (code === "active_booking_limit_exceeded") return "You already have several active bookings.";
    if (code === "late_cancel_limit_exceeded") return "Please contact front desk before booking again.";
    if (code === "PAYNOW_NOT_CONFIGURED") return "PayNow is not configured for this studio yet.";
    return "Could not create booking. Please try again.";
  };

  if (disabled) return null;

  return (
    <button
      type="button"
      disabled={loading}
      className={`${ui.btnPrimary} w-full sm:w-auto disabled:opacity-50`}
      onClick={async () => {
          setLoading(true);
          const res = await fetch("/api/book/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
          const body = await res.json().catch(() => ({}));
          setLoading(false);
          if (!res.ok) {
            toast.error(toFriendly(String(body.error ?? "")));
            return;
          }
          if (body.checkout_url) {
            router.push(body.checkout_url);
          }
        }}
      >
        {loading ? (
        <><Loader2 size={15} className="animate-spin" /> Booking…</>
      ) : (
        <><CreditCard size={15} /> Book now</>
      )}
    </button>
  );
}

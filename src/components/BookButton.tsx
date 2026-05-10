"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { paymentErrorMessage } from "@/lib/paymentErrors";
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

  if (disabled) return null;

  return (
    <button
      type="button"
      disabled={loading}
      className={`${ui.btnPrimary} w-full sm:w-auto disabled:opacity-50`}
      onClick={async () => {
        try {
          setLoading(true);
          const res = await fetch("/api/book/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(paymentErrorMessage(String(body.error ?? ""), body.error_detail));
            return;
          }
          if (body.checkout_url) {
            router.push(body.checkout_url);
          }
        } catch {
          toast.error("Network error. Check your connection and try again.");
        } finally {
          setLoading(false);
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

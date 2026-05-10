"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * While payment is pending, periodically asks the server to pull status from HitPay
 * (same outcome as webhook) so the checkout page updates after PayNow without waiting on webhooks.
 */
export function HitpayCheckoutSync({ paymentId, enabled }: { paymentId: string; enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const run = async () => {
      try {
        const res = await fetch("/api/payment/hitpay/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_id: paymentId }),
        });
        if (res.ok) router.refresh();
      } catch {
        /* ignore */
      }
    };

    void run();
    const interval = setInterval(run, 8000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, paymentId, router]);

  return null;
}

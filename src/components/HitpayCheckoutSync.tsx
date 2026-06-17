"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * While payment is pending, periodically asks the server to pull status from HitPay
 * (same outcome as webhook) so the checkout page updates after PayNow without waiting on webhooks.
 */
export function HitpayCheckoutSync({
  paymentId,
  studioSlug,
  enabled,
}: {
  paymentId: string;
  studioSlug: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false);
  const lastStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    stoppedRef.current = false;
    lastStatusRef.current = null;

    const run = async () => {
      if (inFlightRef.current || stoppedRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/payment/hitpay/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_id: paymentId, studio_slug: studioSlug }),
        });
        if (!res.ok) return;
        const payload = (await res.json().catch(() => null)) as { payment_status?: string | null } | null;
        const status = payload?.payment_status?.toLowerCase() ?? null;
        if (!status) return;

        const prev = lastStatusRef.current;
        lastStatusRef.current = status;
        if (prev !== status && (prev != null || status !== "pending")) {
          router.refresh();
        }

        if (status !== "pending") {
          stoppedRef.current = true;
        }
      } catch {
        /* ignore */
      } finally {
        inFlightRef.current = false;
      }
    };

    void run();
    const interval = setInterval(run, 8000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stoppedRef.current = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, paymentId, router, studioSlug]);

  return null;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Silently refreshes the page every `intervalMs` milliseconds so the
 * payment status is kept up-to-date without requiring a manual reload.
 * Stops polling once the server renders the component with `stop={true}`.
 */
export function PaymentStatusPoller({
  stop = false,
  intervalMs = 5000,
}: {
  stop?: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (stop) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [stop, intervalMs, router]);
  return null;
}

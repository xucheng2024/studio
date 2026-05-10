"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/lib/ui";

const POLL_LOCALE = "en-SG";
const POLL_TZ = "Asia/Singapore";

/**
 * Refreshes the page every `intervalMs` so payment status stays current.
 * Optional `showHint` renders a short status line (last check time, aria-live).
 */
export function PaymentStatusPoller({
  stop = false,
  intervalMs = 5000,
  showHint = false,
}: {
  stop?: boolean;
  intervalMs?: number;
  showHint?: boolean;
}) {
  const router = useRouter();
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);

  useEffect(() => {
    if (stop) return;
    const id = setInterval(() => {
      setLastCheckAt(Date.now());
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [stop, intervalMs, router]);

  if (!showHint || stop) return null;

  const secs = Math.max(1, Math.round(intervalMs / 1000));

  return (
    <p className={`text-xs ${ui.muted}`} aria-live="polite">
      Checking payment status automatically about every {secs}s.
      {lastCheckAt != null
        ? ` Last check: ${new Date(lastCheckAt).toLocaleTimeString(POLL_LOCALE, {
            timeZone: POLL_TZ,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}`
        : null}
    </p>
  );
}

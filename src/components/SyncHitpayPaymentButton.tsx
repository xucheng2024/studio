"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { ui } from "@/lib/ui";

export function SyncHitpayPaymentButton({
  paymentId,
  studioSlug,
  compact = false,
}: {
  paymentId: string;
  studioSlug: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/payment/hitpay/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_id: paymentId,
          studio_slug: studioSlug,
        }),
      });
      const body = await res.json().catch(() => ({})) as {
        error?: string;
        detail?: string;
        hitpay_status?: string | null;
        payment_status?: string | null;
      };
      if (!res.ok) {
        toast.error(body.detail ?? body.error ?? "Could not sync HitPay payment");
        return;
      }
      const hitpayStatus = body.hitpay_status ?? "pending";
      const paymentStatus = body.payment_status ?? "pending";
      toast.success(`Synced: HitPay ${hitpayStatus} · payment ${paymentStatus}`);
      throttledRefresh(router);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      title="Pull the latest one-time payment status from HitPay"
      className={compact
        ? `inline-flex size-8 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 transition hover:bg-stone-50 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800`
        : `${ui.btnSecondarySm} disabled:opacity-60`}
      onClick={() => void sync()}
      aria-label={busy ? "Syncing HitPay payment status" : "Sync HitPay payment status"}
    >
      <RefreshCw size={13} className={busy ? "animate-spin" : ""} aria-hidden />
      {compact ? <span className="sr-only">{busy ? "Syncing..." : "Sync HitPay"}</span> : (busy ? "Syncing..." : "Sync HitPay")}
    </button>
  );
}

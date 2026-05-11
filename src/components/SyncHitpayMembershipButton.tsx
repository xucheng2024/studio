"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

/**
 * Calls POST /api/membership/sync-from-hitpay to reconcile local subscription row with HitPay recurring billing (reference + status scan).
 */
export function SyncHitpayMembershipButton({
  subscriptionId,
  compact,
}: {
  subscriptionId: string;
  /** Smaller padding / icon-only friendly row */
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/membership/sync-from-hitpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_id: subscriptionId }),
      });
      const body = await res.json().catch(() => ({})) as {
        error?: string;
        detail?: string;
        hitpay_status?: string | null;
        subscription_status?: string | null;
      };
      if (!res.ok) {
        const msg =
          typeof body.detail === "string"
            ? body.detail
            : body.error === "subscription_not_found"
              ? "Cannot sync this subscription (missing HitPay reference — contact support)."
              : (body.error ?? "Could not sync");
        toast.error(msg);
        return;
      }
      const hp = body.hitpay_status ?? "—";
      const local = body.subscription_status ?? "—";
      toast.success(`Synced: HitPay ${hp} · account ${local}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      title="Pull latest status from HitPay (fixes delayed webhooks or old orders)"
      className={`inline-flex items-center gap-1.5 ${compact ? `${ui.btnGhost} min-h-8 py-1 text-xs` : ui.btnSecondarySm} disabled:opacity-60`}
      onClick={() => void sync()}
    >
      <RefreshCw size={compact ? 13 : 14} className={busy ? "animate-spin" : ""} aria-hidden />
      {busy ? "Syncing…" : "Sync HitPay"}
    </button>
  );
}

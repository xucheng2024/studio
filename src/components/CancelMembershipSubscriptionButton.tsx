"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

export function CancelMembershipSubscriptionButton({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const cancel = async () => {
    setBusy(true);
    const res = await fetch(`/api/dashboard/subscriptions/${subscriptionId}/cancel`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirm(false);
    if (!res.ok) {
      toast.error(body.error ?? "Cancel failed");
      return;
    }
    toast.success("Subscription canceled");
    router.refresh();
  };

  if (confirm) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs dark:border-red-800/50 dark:bg-red-950/20">
        <AlertTriangle size={11} className="shrink-0 text-red-600 dark:text-red-400" />
        <button
          type="button"
          disabled={busy}
          className="font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
          onClick={() => void cancel()}
        >
          Cancel?
        </button>
        <button type="button" className="text-stone-400 hover:text-stone-600" onClick={() => setConfirm(false)}>
          <X size={11} />
        </button>
      </span>
    );
  }

  return (
    <button type="button" className={ui.btnDangerSm} disabled={busy} onClick={() => setConfirm(true)}>
      Cancel subscription
    </button>
  );
}

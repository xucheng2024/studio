"use client";

import { useState } from "react";
import { toast } from "sonner";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { ui } from "@/lib/ui";

export function SubscribeMembershipButton({
  membershipId,
  studioSlug,
  label,
}: {
  membershipId: string;
  studioSlug: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/membership/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId, slug: studioSlug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === "subscription_exists") {
          toast.info("You already have an active or pending membership for this plan.");
          return;
        }
        toast.error(paymentErrorMessage(String(body.error ?? ""), body.error_detail));
        return;
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      className={`${ui.btnPrimarySm} disabled:opacity-60`}
      onClick={() => void start()}
    >
      {busy ? "Continuing…" : (label ?? "Subscribe")}
    </button>
  );
}


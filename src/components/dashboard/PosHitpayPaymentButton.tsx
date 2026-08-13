"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

export function PosHitpayPaymentButton(props: {
  studioId: string;
  saleId: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className={ui.btnPrimarySm}
      disabled={busy || props.disabled}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          const res = await fetch("/api/pos/payments/hitpay/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              studio_id: props.studioId,
              sale_id: props.saleId,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = String(body?.message ?? body?.error_detail ?? body?.error ?? "hitpay_request_failed");
            toast.error(`HitPay request failed: ${msg}`);
            return;
          }
          const checkoutUrl = String(body?.checkout_url ?? "").trim();
          if (!checkoutUrl) {
            toast.error("HitPay checkout URL is missing.");
            return;
          }
          window.location.href = checkoutUrl;
        } catch {
          toast.error("Could not start HitPay checkout.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Opening HitPay…" : "Pay with HitPay"}
    </button>
  );
}

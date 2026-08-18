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
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  async function startHitpay() {
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
        console.log("PosHitpayPaymentButton failed", { status: res.status, body });
        toast.error(`HitPay request failed: ${msg}`);
        return;
      }
      const nextUrl = String(body?.checkout_url ?? "").trim();
      if (!nextUrl) {
        toast.error("HitPay checkout URL is missing.");
        return;
      }
      setCheckoutUrl(nextUrl);
      toast.success("HitPay link ready. Keep this page open.");
    } catch (error) {
      console.log("PosHitpayPaymentButton exception", error);
      toast.error("Could not start HitPay checkout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={ui.btnPrimarySm}
        disabled={busy || props.disabled}
        onClick={() => void startHitpay()}
      >
        {busy ? "Opening HitPay…" : checkoutUrl ? "Refresh HitPay link" : "Pay with HitPay"}
      </button>
      {checkoutUrl ? (
        <>
          <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className={ui.btnSecondarySm}>
            Open HitPay
          </a>
          <button
            type="button"
            className={ui.btnGhost}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(checkoutUrl);
                toast.success("HitPay link copied.");
              } catch (error) {
                console.log("PosHitpayPaymentButton copy failed", error);
                toast.error("Could not copy HitPay link.");
              }
            }}
          >
            Copy link
          </button>
        </>
      ) : null}
    </div>
  );
}

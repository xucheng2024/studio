"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function PaymentMarkButton({
  paymentId,
  status,
  label,
  onDone,
}: {
  paymentId: string;
  status: "paid" | "failed" | "expired" | "refunded";
  label: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const buildBody = () => {
    const base = { payment_id: paymentId, status } as Record<string, unknown>;
    if (status === "refunded") {
      const note = refundReason.trim();
      if (note.length > 0) base.refund_reason = note;
    }
    return base;
  };

  const button = (
    <button
      type="button"
      disabled={busy}
      className={`${status === "paid" ? ui.btnPrimarySm : ui.btnSecondarySm} disabled:opacity-50`}
      onClick={async () => {
        if (status !== "paid") {
          const ok = window.confirm(`Confirm ${label.toLowerCase()} for this payment?`);
          if (!ok) return;
        }
        setBusy(true);
        await fetch("/api/payment/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody()),
        });
        setBusy(false);
        if (status === "refunded") setRefundReason("");
        if (onDone) onDone();
        else router.refresh();
      }}
    >
      {busy ? "..." : label}
    </button>
  );

  if (status === "refunded") {
    return (
      <div className="flex min-w-48 max-w-xs flex-col gap-1.5">
        <label className={`${ui.label} sr-only`} htmlFor={`refund-reason-${paymentId}`}>
          Refund note (optional)
        </label>
        <textarea
          id={`refund-reason-${paymentId}`}
          className={`${ui.input} min-h-11 resize-y text-sm`}
          placeholder="Refund note (optional)"
          rows={2}
          maxLength={500}
          value={refundReason}
          disabled={busy}
          onChange={(e) => setRefundReason(e.target.value)}
        />
        {button}
      </div>
    );
  }

  return button;
}

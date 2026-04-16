"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function PaymentMarkButton({
  paymentId,
  status,
  label,
}: {
  paymentId: string;
  status: "paid" | "failed" | "expired" | "refunded";
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      className={`${status === "paid" ? ui.btnPrimarySm : ui.btnSecondarySm} disabled:opacity-50`}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/payment/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_id: paymentId, status }),
        });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "..." : label}
    </button>
  );
}

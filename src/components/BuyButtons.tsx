"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { ui } from "@/lib/ui";

export function BuyPackageButton({
  packageId,
  disabled = false,
}: {
  packageId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading || disabled}
      className={`${ui.btnPrimarySm} disabled:opacity-50`}
      onClick={async () => {
        setLoading(true);
        const res = await fetch("/api/package/buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package_id: packageId }),
        });
        const body = await res.json().catch(() => ({}));
        setLoading(false);
        if (!res.ok) {
          toast.error(paymentErrorMessage(String(body.error ?? ""), body.error_detail));
          return;
        }
        if (body.checkout_url) {
          router.push(body.checkout_url);
        }
      }}
    >
      {loading ? "…" : disabled ? "Online payment unavailable" : "Buy pack"}
    </button>
  );
}

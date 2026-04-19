"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
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
          if (body.error === "PAYNOW_NOT_CONFIGURED") {
            toast.error("PayNow is not configured for this studio yet.");
          } else {
            toast.error(body.error ?? "Purchase failed");
          }
          return;
        }
        if (body.checkout_url) {
          router.push(body.checkout_url);
        }
      }}
    >
      {loading ? "…" : disabled ? "PayNow unavailable" : "Buy pack"}
    </button>
  );
}

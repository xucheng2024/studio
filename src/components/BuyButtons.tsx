"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={loading || disabled}
        className={`${ui.btnPrimarySm} disabled:opacity-50`}
        onClick={async () => {
          setLoading(true);
          setMsg(null);
          const res = await fetch("/api/package/buy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ package_id: packageId }),
          });
          const body = await res.json().catch(() => ({}));
          setLoading(false);
          if (!res.ok) {
            if (body.error === "PAYNOW_NOT_CONFIGURED") {
              setMsg("PayNow is not configured for this studio yet.");
            } else {
              setMsg(body.error ?? "Failed");
            }
            return;
          }
          if (body.checkout_url) {
            router.push(body.checkout_url);
            return;
          }
          setMsg("Payment created");
        }}
      >
        {loading ? "..." : disabled ? "PayNow unavailable" : "Buy pack"}
      </button>
      {msg ? <span className={`text-xs ${ui.muted}`}>{msg}</span> : null}
    </div>
  );
}


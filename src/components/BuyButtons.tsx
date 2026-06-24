"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { ui } from "@/lib/ui";

export function BuyPackageButton({
  packageId,
  studioSlug,
  disabled = false,
}: {
  packageId: string;
  studioSlug?: string;
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
        try {
          setLoading(true);
          const res = await fetch("/api/package/buy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ package_id: packageId, slug: studioSlug }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(paymentErrorMessage(String(body.error ?? ""), body.error_detail));
            return;
          }
          if (body.checkout_url) {
            router.push(body.checkout_url);
          }
        } catch {
          toast.error("Network error. Check your connection and try again.");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? <><Loader2 size={14} className="animate-spin" /> Processing…</> : disabled ? "Online payment unavailable" : "Buy pack"}
    </button>
  );
}

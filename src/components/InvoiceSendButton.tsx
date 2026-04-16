"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function InvoiceSendButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={`${ui.btnSecondarySm} disabled:opacity-50`}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/invoice/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment_id: paymentId }),
          });
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) {
            setMsg(json?.error ?? "send_failed");
            setBusy(false);
            return;
          }
          setMsg("sent");
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? "Sending..." : "Send invoice"}
      </button>
      {msg ? <span className="text-xs text-stone-500">{msg}</span> : null}
    </div>
  );
}


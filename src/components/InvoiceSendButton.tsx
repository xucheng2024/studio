"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { ui } from "@/lib/ui";

export function InvoiceSendButton({ paymentId, invoiceNumber }: { paymentId: string; invoiceNumber?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {/* Preview / download in new tab */}
      <a
        href={`/api/invoice/pdf/${paymentId}`}
        target="_blank"
        rel="noopener noreferrer"
        title={invoiceNumber ? `Preview ${invoiceNumber}` : "Preview invoice"}
        className={ui.btnSecondarySm}
      >
        <FileText size={13} />
        Preview
      </a>

      {/* Send by email */}
      <button
        type="button"
        disabled={busy}
        className={`${ui.btnSecondarySm} disabled:opacity-50`}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/invoice/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment_id: paymentId }),
          });
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          setBusy(false);
          if (!res.ok) {
            toast.error(json?.error ?? "Failed to send invoice");
            return;
          }
          toast.success("Invoice sent");
          router.refresh();
        }}
      >
        {busy ? "Sending…" : "Send invoice"}
      </button>
    </div>
  );
}

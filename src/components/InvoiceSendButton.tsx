"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { ui } from "@/lib/ui";

function invoiceSendErrorMessage(code: string | undefined) {
  if (!code) return "Failed to send invoice";
  if (code === "invoice_requires_paid_status") return "Only paid records can send invoices.";
  if (code === "invoice_voided") return "This invoice is voided and cannot be sent.";
  if (code === "invoice_recipient_not_found") return "No recipient email found for this payment.";
  if (code === "invoice_email_not_configured") return "Email is not configured on server (Resend).";
  if (code === "invoice_send_failed") return "Email provider failed to send. Please try again.";
  return "Failed to send invoice";
}

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
            toast.error(invoiceSendErrorMessage(json?.error));
            return;
          }
          toast.success("Invoice sent");
          throttledRefresh(router);
        }}
      >
        {busy ? "Sending…" : "Send invoice"}
      </button>
    </div>
  );
}

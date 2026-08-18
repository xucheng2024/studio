"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

function payslipSendErrorMessage(code: string | undefined) {
  if (code === "forbidden") return "You can only email your own payslip.";
  if (code === "not_found") return "Payslip not found.";
  if (code === "recipient_not_found") return "No employee email on file.";
  if (code === "email_not_configured") return "Email is not configured for this studio (Resend).";
  if (code === "send_failed") return "Email provider failed to send. Please try again.";
  return "Failed to send payslip";
}

export function PayslipSendButton({ runEmployeeId }: { runEmployeeId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={`${ui.btnSecondarySm} disabled:opacity-50`}
      onClick={async () => {
        setBusy(true);
        const res = await fetch(`/api/payroll/payslip/${runEmployeeId}/email`, { method: "POST" });
        const json = (await res.json().catch(() => null)) as { error?: string; recipient?: string } | null;
        setBusy(false);
        if (!res.ok) {
          console.error("[PAY-03] payslip email UI failed", { status: res.status, error: json?.error });
          toast.error(payslipSendErrorMessage(json?.error));
          return;
        }
        toast.success(json?.recipient ? `Payslip sent to ${json.recipient}` : "Payslip sent");
      }}
    >
      {busy ? "Sending…" : "Email PDF"}
    </button>
  );
}

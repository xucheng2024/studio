"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import {
  CheckCircle2, XCircle, RefreshCcw, Ban,
  AlertTriangle, Check, X, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

const statusConfig = {
  paid:     { icon: CheckCircle2, color: "teal",   confirm: false },
  failed:   { icon: XCircle,      color: "red",    confirm: true  },
  expired:  { icon: Ban,          color: "stone",  confirm: true  },
  refunded: { icon: RefreshCcw,   color: "amber",  confirm: true  },
} as const;

type Status = keyof typeof statusConfig;

export function PaymentMarkButton({
  paymentId,
  status,
  label,
  onDone,
}: {
  paymentId: string;
  status: Status;
  label: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const cfg = statusConfig[status];
  const Icon = cfg.icon;

  const execute = async () => {
    setBusy(true);
    setConfirming(false);
    const body: Record<string, unknown> = { payment_id: paymentId, status };
    if (status === "refunded" && refundReason.trim()) {
      body.refund_reason = refundReason.trim();
    }
    const res = await fetch("/api/payment/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      toast.error(errBody.message ?? errBody.error ?? "Action failed");
      return;
    }
    const successMessages: Record<string, string> = {
      paid: "Payment confirmed",
      failed: "Marked as failed",
      expired: "Marked as expired",
      refunded: "Refund recorded",
    };
    toast.success(successMessages[status] ?? "Done");
    if (status === "refunded") {
      setRefundReason("");
    }
    if (onDone) onDone();
    else throttledRefresh(router);
  };

  const btnClass =
    status === "paid"
      ? ui.btnPrimarySm
      : status === "refunded"
        ? `${ui.btnSecondarySm} border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300`
        : `${ui.btnSecondarySm} border-red-200 text-red-700 dark:border-red-800/60 dark:text-red-400`;

  if (busy) {
    return (
      <span className="inline-flex min-h-10 items-center gap-1.5 text-xs text-stone-400">
        <Loader2 size={12} className="animate-spin" />
        {label}…
      </span>
    );
  }

  /* Refund: always show textarea before confirm */
  if (status === "refunded") {
    if (!confirming) {
      return (
        <button type="button" className={btnClass} onClick={() => setConfirming(true)}>
          <Icon size={13} />
          {label}
        </button>
      );
    }
    return (
      <div className="flex min-w-48 max-w-xs flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-800/50 dark:bg-amber-950/20">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle size={12} />
          Confirm refund?
        </p>
        <textarea
          className={`${ui.input} min-h-10 resize-y text-sm`}
          placeholder="Refund note (optional)"
          rows={2}
          maxLength={500}
          value={refundReason}
          onChange={(e) => setRefundReason(e.target.value)}
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            className={ui.btnPrimarySm}
            onClick={() => void execute()}
          >
            <Check size={11} />
            Refund
          </button>
          <button
            type="button"
            className={ui.btnGhost}
            onClick={() => {
              setConfirming(false);
              setRefundReason("");
            }}
          >
            <X size={11} />
          </button>
        </div>
      </div>
    );
  }

  /* Non-paid statuses with optional inline confirmation */
  if (cfg.confirm && confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="w-full text-xs text-stone-600 dark:text-stone-400 sm:w-auto">Sure?</span>
        <button
          type="button"
          className={ui.btnDangerSm}
          onClick={() => void execute()}
        >
          <Check size={11} />
          Yes
        </button>
        <button type="button" className={ui.btnGhost} onClick={() => setConfirming(false)}>
          <X size={11} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={btnClass}
      onClick={() => { if (cfg.confirm) setConfirming(true); else void execute(); }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type Step = "idle" | "confirming" | "busy";

function cancelErrorMessage(error: string, detail?: string): string {
  const e = String(error ?? "").trim();
  if (e === "hitpay_recurring_cancel_failed") return "Could not cancel the recurring billing on HitPay. Please try again or contact the studio.";
  if (e === "hitpay_refund_failed") return "Cancellation was recorded but the refund could not be processed automatically. Please contact the studio.";
  if (e === "gateway_payment_id_missing") return "Refund could not be initiated — payment reference is missing. Please contact the studio.";
  if (e === "hitpay_not_configured") return "Payment is not configured for this studio. Please contact the studio to cancel.";
  if (e === "not_found") return "Subscription not found.";
  if (e === "forbidden") return "You are not authorised to cancel this subscription.";
  if (detail) return `${e} — ${detail}`;
  return "Could not cancel. Please try again or contact the studio.";
}

export function CancelMyMembershipButton({
  subscriptionId,
  label,
  inTrial,
}: {
  subscriptionId: string;
  label?: string;
  inTrial?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");

  const cancel = async () => {
    setStep("busy");
    try {
      const res = await fetch("/api/membership/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_id: subscriptionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(cancelErrorMessage(String(body.error ?? ""), body.error_detail));
        setStep("idle");
        return;
      }
      const mode = String(body?.mode ?? "");
      const periodEnd = body?.current_period_end
        ? new Date(body.current_period_end).toLocaleDateString("en-SG", {
            year: "numeric",
            month: "short",
            day: "numeric",
            timeZone: "Asia/Singapore",
          })
        : null;
      const successMsg =
        mode === "trial_refunded"
          ? "Trial cancelled — a refund is being processed to your original payment method."
          : mode === "trial"
          ? "Trial cancelled — you won't be charged."
          : mode === "period_end"
          ? periodEnd
            ? `Cancellation scheduled — your access continues until ${periodEnd}.`
            : "Cancellation scheduled — your access continues until the end of this period."
          : "Membership cancelled.";
      toast.success(successMsg, { duration: 6000 });
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
      setStep("idle");
    }
  };

  if (step === "confirming") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm ${ui.muted}`}>
          {inTrial ? "Cancel trial and request a refund?" : "Confirm cancellation?"}
        </span>
        <button
          type="button"
          className={`${ui.btnSecondarySm} border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/20`}
          onClick={() => void cancel()}
        >
          Yes, cancel
        </button>
        <button
          type="button"
          className={ui.btnSecondarySm}
          onClick={() => setStep("idle")}
        >
          Keep it
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={step === "busy"}
      className={`${ui.btnSecondarySm} border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/20 disabled:opacity-60`}
      onClick={() => setStep("confirming")}
    >
      {step === "busy" ? "Cancelling…" : (label ?? "Cancel")}
    </button>
  );
}

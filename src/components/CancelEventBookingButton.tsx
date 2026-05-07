"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type Step = "idle" | "confirm" | "busy" | "error";

export function CancelEventBookingButton({
  eventBookingId,
  label,
}: {
  eventBookingId: string;
  label?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (step === "idle") {
    return (
      <button type="button" className={ui.btnDangerSm} onClick={() => setStep("confirm")}>
        Cancel booking
      </button>
    );
  }

  if (step === "confirm") {
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-full text-stone-500 dark:text-stone-400 sm:w-auto">
          {label ? `Cancel booking for ${label}?` : "Cancel this attendee booking?"}
        </span>
        <button
          type="button"
          className={ui.btnDangerSm}
          onClick={async () => {
            setStep("busy");
            const res = await fetch("/api/event-booking/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event_booking_id: eventBookingId }),
            });
            if (res.ok) {
              toast.success("Booking cancelled");
              router.refresh();
            } else {
              const body = await res.json().catch(() => ({}));
              setErrMsg(body.error ?? "Cancel failed. Please try again.");
              setStep("error");
            }
          }}
        >
          Confirm cancel
        </button>
        <button type="button" className={ui.btnGhost} onClick={() => setStep("idle")}>
          <X size={11} />
        </button>
      </span>
    );
  }

  if (step === "busy") {
    return (
      <span className="flex items-center gap-1 text-xs text-stone-400">
        <Loader2 size={11} className="animate-spin" /> Cancelling...
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
      <AlertCircle size={11} />
      {errMsg}
      <button type="button" className="ml-1 underline" onClick={() => setStep("idle")}>
        Dismiss
      </button>
    </span>
  );
}

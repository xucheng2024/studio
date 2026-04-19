"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type Step = "idle" | "confirm" | "busy" | "error";

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (step === "idle") {
    return (
      <button
        type="button"
        className={`text-xs ${ui.linkMuted}`}
        onClick={() => setStep("confirm")}
      >
        Cancel
      </button>
    );
  }

  if (step === "confirm") {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-stone-500 dark:text-stone-400">Cancel this booking?</span>
        <button
          type="button"
          className="font-medium text-red-600 hover:underline dark:text-red-400"
          onClick={async () => {
            setStep("busy");
            const res = await fetch("/api/book/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ booking_id: bookingId }),
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
          Yes
        </button>
        <button
          type="button"
          className={`${ui.linkMuted}`}
          onClick={() => setStep("idle")}
        >
          <X size={11} />
        </button>
      </span>
    );
  }

  if (step === "busy") {
    return (
      <span className="flex items-center gap-1 text-xs text-stone-400">
        <Loader2 size={11} className="animate-spin" /> Cancelling…
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
      <AlertCircle size={11} />
      {errMsg}
      <button
        type="button"
        className="ml-1 underline"
        onClick={() => setStep("idle")}
      >
        Dismiss
      </button>
    </span>
  );
}

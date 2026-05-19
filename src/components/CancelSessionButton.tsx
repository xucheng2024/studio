"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { AlertTriangle, CalendarX, Check, X, Loader2 } from "lucide-react";
import { ui } from "@/lib/ui";

type Step = "idle" | "confirm" | "busy" | "done" | "error";

export function CancelSessionButton({
  sessionId,
  classTitle,
  startTimeIso,
  locationName,
  sessionStatus,
}: {
  sessionId: string;
  classTitle: string;
  startTimeIso: string;
  locationName: string | null;
  sessionStatus: string | null | undefined;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{
    affected: number;
    refunds: number;
    credits: number;
    alreadyCancelled: boolean;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const scheduled = (sessionStatus ?? "scheduled") === "scheduled";
  if (!scheduled) return null;

  const doCancel = async () => {
    setStep("busy");
    setErrorMsg(null);
    const res = await fetch("/api/session/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, reason: reason.trim() || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      setErrorMsg(data.error ? String(data.error) : "Cancel failed. Please try again.");
      setStep("error");
      return;
    }
    setResult({
      affected: Number(data.affected_bookings ?? 0),
      refunds: Number(data.payments_refunded_count ?? 0),
      credits: Number(data.credits_returned_count ?? 0),
      alreadyCancelled: data.already_cancelled === true,
    });
    setStep("done");
    throttledRefresh(router);
  };

  if (step === "idle") {
    return (
      <button
        type="button"
        className={`${ui.btnSecondarySm} border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800/60 dark:text-red-400 dark:hover:bg-red-950/30`}
        onClick={() => setStep("confirm")}
      >
        <CalendarX size={13} />
        Cancel this session
      </button>
    );
  }

  if (step === "confirm") {
    return (
      <div className="w-full max-w-sm rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900/50 dark:bg-red-950/20">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">Cancel this session?</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
              {classTitle} · {new Date(startTimeIso).toLocaleString()}
              {locationName ? ` · ${locationName}` : ""}
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              All active bookings will be cancelled. Refunds and class passes apply automatically.
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              This does not delete the session or its historical records.
            </p>
          </div>
        </div>
        <label className="mt-2.5 flex flex-col gap-1">
          <span className={`${ui.label} text-xs`}>Reason (optional)</span>
          <textarea
            className={`${ui.input} min-h-10 resize-y text-sm`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Shown in studio records"
          />
        </label>
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 active:scale-[0.98]"
            onClick={() => void doCancel()}
          >
            <CalendarX size={13} />
            Confirm cancellation
          </button>
          <button
            type="button"
            className={ui.btnGhost}
            onClick={() => { setStep("idle"); setReason(""); }}
          >
            <X size={13} />
            Keep it
          </button>
        </div>
      </div>
    );
  }

  if (step === "busy") {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
        <Loader2 size={14} className="animate-spin" />
        Cancelling…
      </div>
    );
  }

  if (step === "done" && result) {
    if (result.alreadyCancelled) {
      return (
        <p className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <Check size={12} />
          Already cancelled — no changes made.
        </p>
      );
    }
    return (
      <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2 dark:border-teal-800/50 dark:bg-teal-950/20">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-800 dark:text-teal-300">
          <Check size={14} />
          Session cancelled
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-teal-700 dark:text-teal-400">
          <span>{result.affected} booking{result.affected !== 1 ? "s" : ""} cancelled</span>
          {result.refunds > 0 && <span>{result.refunds} payment{result.refunds !== 1 ? "s" : ""} refunded</span>}
          {result.credits > 0 && <span>{result.credits} class pass{result.credits !== 1 ? "es" : ""} returned</span>}
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle size={12} />
          {errorMsg}
        </p>
        <button type="button" className={ui.btnGhost} onClick={() => setStep("idle")}>
          Try again
        </button>
      </div>
    );
  }

  return null;
}

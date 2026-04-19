"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Loader2, CheckCheck, AlertCircle } from "lucide-react";
import { ui } from "@/lib/ui";

export function ConfirmPaymentButton({
  paymentId,
  expiresAt,
  referenceCode,
  paymentStatus,
  customerConfirmedAt,
}: {
  paymentId: string;
  expiresAt: string | null;
  referenceCode: string | null;
  paymentStatus: "pending" | "paid" | "failed" | "expired";
  customerConfirmedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(customerConfirmedAt));
  const [note, setNote] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const leftMs = useMemo(() => {
    if (!expiresAt || now === 0) return null;
    return Math.max(0, new Date(expiresAt).getTime() - now);
  }, [expiresAt, now]);

  const countdown = useMemo(() => {
    if (leftMs == null) return null;
    const totalSec = Math.floor(leftMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }, [leftMs]);

  const expired = leftMs === 0;
  const urgent = leftMs != null && leftMs < 5 * 60 * 1000 && leftMs > 0;
  const warning = leftMs != null && leftMs < 10 * 60 * 1000 && !urgent;

  const countdownColor = expired
    ? "text-red-600 dark:text-red-400"
    : urgent
      ? "text-red-500 dark:text-red-400"
      : warning
        ? "text-amber-600 dark:text-amber-400"
        : "text-stone-500 dark:text-stone-400";

  const disabled = busy || expired || paymentStatus !== "pending" || submitted;

  const toFriendly = (code: string) => {
    if (code === "not_pending") return "This payment is no longer pending.";
    if (code === "forbidden") return "Please sign in with the same booking account.";
    if (code === "payment_not_found") return "Payment record not found.";
    return "Could not submit. Please try again.";
  };

  /* Already-submitted success card */
  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-5 text-center dark:border-teal-800/50 dark:bg-teal-950/30">
        <CheckCircle2 size={28} className="text-teal-600 dark:text-teal-400" />
        <p className="font-semibold text-teal-900 dark:text-teal-200">Payment notice submitted</p>
        <p className={`text-sm ${ui.muted}`}>
          Staff will verify your transfer and confirm your booking shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Countdown */}
      {countdown !== null ? (
        <div className={`flex items-center justify-center gap-1.5 text-sm font-medium ${countdownColor}`}>
          <Clock size={14} />
          {expired ? "Link expired" : `Expires in ${countdown}`}
        </div>
      ) : null}

      {/* Primary CTA — large green button with subtle pulse ring */}
      <button
        type="button"
        disabled={disabled}
        className={`
          relative w-full rounded-2xl py-4 text-base font-bold tracking-wide text-white
          transition-all duration-200 active:scale-[0.98]
          disabled:pointer-events-none disabled:opacity-50
          ${disabled
            ? "bg-stone-400"
            : "bg-linear-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-600/30 hover:shadow-xl hover:shadow-emerald-500/35 hover:brightness-105"
          }
        `}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          setIsError(false);
          const res = await fetch("/api/payment/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment_id: paymentId, note, reference_code: referenceCode }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            setMsg(toFriendly(String(body.error ?? "")));
            setIsError(true);
            return;
          }
          setSubmitted(true);
          router.refresh();
        }}
      >
        {/* Pulsing ring shown only when active + not busy */}
        {!disabled && !busy ? (
          <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-emerald-400/60 ring-offset-2 ring-offset-white animate-pulse dark:ring-offset-stone-950" />
        ) : null}
        <span className="relative flex items-center justify-center gap-2">
          {busy ? (
            <><Loader2 size={18} className="animate-spin" /> Submitting…</>
          ) : (
            <><CheckCheck size={18} /> I&apos;ve paid — notify staff</>
          )}
        </span>
      </button>

      {/* Error */}
      {msg && isError ? (
        <p className="flex items-center justify-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={14} />
          {msg}
        </p>
      ) : null}

      {/* Optional note — collapsed by default */}
      <details className="chevron rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-700">
        <summary className={`cursor-pointer text-xs ${ui.muted}`}>
          Add a note (optional)
        </summary>
        <label className="mt-2 flex flex-col gap-1.5">
          <span className={ui.label}>Transfer time or account info</span>
          <textarea
            className={ui.input}
            rows={2}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Paid at 10:32 from DBS account…"
          />
        </label>
      </details>

      <p className={`text-center text-xs ${ui.muted}`}>
        Staff will verify and confirm your booking shortly.
      </p>
    </div>
  );
}

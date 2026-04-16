"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  const [note, setNote] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const leftMs = useMemo(() => {
    if (now === 0) return null;
    if (!expiresAt) return null;
    return Math.max(0, new Date(expiresAt).getTime() - now);
  }, [expiresAt, now]);

  const countdown = useMemo(() => {
    if (leftMs == null) return "No expiry";
    const totalSec = Math.floor(leftMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }, [leftMs]);

  const alreadySubmitted = Boolean(customerConfirmedAt);
  const disabled = busy || leftMs === 0 || paymentStatus !== "pending" || alreadySubmitted;
  const toFriendly = (code: string) => {
    if (code === "not_pending") return "This payment is no longer pending.";
    if (code === "forbidden") return "Please sign in with the same booking account.";
    if (code === "payment_not_found") return "Payment record not found.";
    return "Could not submit payment notice. Please try again.";
  };

  return (
    <div className="flex flex-col gap-2">
      <p className={ui.muted}>
        Time left: <span className="font-mono tabular-nums">{countdown}</span>
      </p>
      <button
        type="button"
        disabled={disabled}
        className={`${ui.btnPrimary} disabled:opacity-50`}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/payment/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment_id: paymentId, note, reference_code: referenceCode }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            setMsg(toFriendly(String(body.error ?? "")));
            return;
          }
          setMsg(
            body.already_confirmed
              ? "Payment notice already submitted. Staff will verify shortly."
              : "Payment submitted for review. Staff will verify and confirm your booking.",
          );
          router.refresh();
        }}
      >
        {busy ? "Submitting..." : alreadySubmitted ? "Submitted" : "I have paid"}
      </button>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Optional note (transfer time / account)</span>
        <textarea
          className={ui.input}
          rows={3}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Paid at 10:32 from DBS account..."
        />
      </label>
      {msg ? <p className={ui.muted}>{msg}</p> : null}
    </div>
  );
}

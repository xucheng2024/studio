"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { getBrowserSession } from "@/lib/supabase/client";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { ui } from "@/lib/ui";

const MAX_SERVICE_QTY = 10;

type Props = {
  slug: string;
  serviceId: string;
  unitPrice?: number;
  submitLabel?: string;
  noteLabel?: string;
  notePlaceholder?: string;
};

export function ServicePurchasePanel({
  slug,
  serviceId,
  unitPrice = 0,
  submitLabel,
  noteLabel = "What should the studio know?",
  notePlaceholder = "Optional details such as preferred time, goals, or questions.",
}: Props) {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const total = Math.round(Number(unitPrice) * qty * 100) / 100;
  const payLabel =
    submitLabel ??
    (total > 0 ? `Pay ${STUDIO_CURRENCY} ${total.toFixed(2)}` : "Confirm order");

  useEffect(() => {
    getBrowserSession()
      .then((session) => setIsLoggedIn(Boolean(session?.user)))
      .catch(() => setIsLoggedIn(false));
  }, []);

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/service/purchase/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          service_id: serviceId,
          guest_name: isLoggedIn ? undefined : guestName.trim(),
          guest_email: isLoggedIn ? undefined : guestEmail.trim().toLowerCase(),
          guest_phone: isLoggedIn ? undefined : guestPhone.trim(),
          note: note.trim() || undefined,
          qty,
        }),
      });
      const body = await res.json().catch(() => ({}));
      const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
      if (!res.ok) {
        console.error("[service-purchase] failed", { status: res.status, error: body.error, qty });
        setError(message);
        return { ok: false as const, message };
      }
      if (body.checkout_url) {
        router.push(body.checkout_url);
      }
      return { ok: true as const };
    } catch {
      const message = "Network error. Check your connection and try again.";
      setError(message);
      return { ok: false as const, message };
    } finally {
      setLoading(false);
    }
  };

  const qtyField = (
    <div className="flex items-center justify-between gap-3">
      <span className={ui.label}>Quantity</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={ui.btnSecondarySm}
          disabled={loading || qty <= 1}
          onClick={() => setQty((value) => Math.max(1, value - 1))}
          aria-label="Decrease quantity"
        >
          -
        </button>
        <span className="min-w-6 text-center text-sm font-medium tabular-nums text-stone-900 dark:text-stone-100">{qty}</span>
        <button
          type="button"
          className={ui.btnSecondarySm}
          disabled={loading || qty >= MAX_SERVICE_QTY}
          onClick={() => setQty((value) => Math.min(MAX_SERVICE_QTY, value + 1))}
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
    </div>
  );

  const noteField = (
    <label className="flex flex-col gap-1">
      <span className={ui.label}>{noteLabel}</span>
      <textarea
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={notePlaceholder}
        className={`${ui.input} resize-none`}
      />
    </label>
  );

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900 sm:p-5">
      <div className="mb-4">
        <p className="text-base font-semibold text-stone-900 dark:text-stone-100">Secure checkout</p>
        <p className={`mt-1 text-sm ${ui.muted}`}>Pay now and the studio will receive your order details right away.</p>
      </div>

      {isLoggedIn === false ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Name</span>
            <input
              className={ui.input}
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Email</span>
            <input
              type="email"
              className={ui.input}
              value={guestEmail}
              onChange={(event) => setGuestEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Phone</span>
            <PhoneNumberInput value={guestPhone} onChange={setGuestPhone} placeholder="9123 4567" required />
          </label>
          {qtyField}
          {noteField}
          <button
            type="submit"
            disabled={loading || !guestName.trim() || !guestEmail.trim() || !guestPhone.trim()}
            className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
          >
            {loading ? <><Loader2 size={15} className="animate-spin" /> Processing...</> : payLabel}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {qtyField}
          {noteField}
          <button
            type="button"
            disabled={loading || isLoggedIn === null}
            className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
            onClick={() => void handleSubmit()}
          >
            {loading ? <><Loader2 size={15} className="animate-spin" /> Processing...</> : payLabel}
          </button>
        </div>
      )}

      {error ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

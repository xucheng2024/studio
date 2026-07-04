"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { getBrowserSession } from "@/lib/supabase/client";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { ui } from "@/lib/ui";

type Props = {
  slug: string;
  serviceId: string;
  submitLabel?: string;
  noteLabel?: string;
  notePlaceholder?: string;
};

export function ServicePurchasePanel({
  slug,
  serviceId,
  submitLabel = "Pay now",
  noteLabel = "What should the studio know?",
  notePlaceholder = "Optional details such as preferred time, goals, or questions.",
}: Props) {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    getBrowserSession()
      .then((session) => setIsLoggedIn(Boolean(session?.user)))
      .catch(() => setIsLoggedIn(false));
  }, []);

  const handleSubmit = async (payload: EmailFirstCheckoutPayload = {}) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/service/purchase/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          service_id: serviceId,
          guest_name: isLoggedIn ? undefined : payload.guest_name,
          guest_email: isLoggedIn ? undefined : payload.guest_email,
          guest_phone: isLoggedIn ? undefined : payload.guest_phone,
          note: note.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
      if (!res.ok) {
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
        <EmailFirstCheckout
          submitLabel={submitLabel}
          busyLabel="Processing..."
          onSubmit={(payload) => handleSubmit(payload)}
          extraFields={noteField}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {noteField}
          <button
            type="button"
            disabled={loading || isLoggedIn === null}
            className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
            onClick={() => void handleSubmit()}
          >
            {loading ? <><Loader2 size={15} className="animate-spin" /> Processing...</> : submitLabel}
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

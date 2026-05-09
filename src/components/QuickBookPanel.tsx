"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, X, AlertCircle } from "lucide-react";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type Props = {
  slug: string;
  sessionId: string;
  payLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  triggerLabel?: string;
  defaultOpen?: boolean;
  hideClose?: boolean;
  /** Render only the form fields with no outer card wrapper or header. */
  embedded?: boolean;
};

export function QuickBookPanel({
  slug,
  sessionId,
  payLabel = "Pay now",
  disabled,
  triggerClassName,
  triggerLabel = "Book now",
  defaultOpen = false,
  hideClose = false,
  embedded = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setIsLoggedIn(!!data.session?.user));
  }, []);

  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please choose another session.";
    if (code === "already_has_booking") return "You already have a booking for this session.";
    if (code === "hitpay_not_configured")
      return "This studio has not configured online payment yet. Please contact the front desk.";
    if (code === "guest_details_required") return "Please enter your name, email, and phone number.";
    return "Could not continue. Please check your details and try again.";
  };

  const handleSubmit = async (payload: EmailFirstCheckoutPayload = {}) => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/book/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        session_id: sessionId,
        guest_name: isLoggedIn ? undefined : payload.guest_name,
        guest_email: isLoggedIn ? undefined : payload.guest_email,
        guest_phone: isLoggedIn ? undefined : payload.guest_phone,
      }),
    });
    const body = await res.json().catch(() => ({}));
    const message = toFriendly(String(body.error ?? ""));
    setLoading(false);
    if (!res.ok) {
      setError(message);
      if (isLoggedIn) setOpen(true);
      return { ok: false as const, message };
    }
    if (body.checkout_url) {
      router.push(body.checkout_url);
    }
    return { ok: true as const };
  };

  if (disabled) return null;

  if (!open) {
    if (embedded) return null;
    return (
      <button
        type="button"
        className={triggerClassName ?? ui.btnPrimarySm}
        disabled={loading || isLoggedIn === null}
        onClick={() => {
          setError(null);
          if (isLoggedIn) {
            void handleSubmit();
            return;
          }
          setOpen(true);
        }}
      >
        {loading ? (
          <><Loader2 size={15} className="animate-spin" /> Processing...</>
        ) : (
          triggerLabel
        )}
      </button>
    );
  }

  const loggedInForm = (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </p>
      ) : null}

      <div className={embedded ? "" : ui.mobileActionBar}>
        <button
          type="button"
          disabled={loading}
          className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
          onClick={() => void handleSubmit()}
        >
          {loading ? (
            <><Loader2 size={15} className="animate-spin" /> Processing…</>
          ) : (
            <>{payLabel}</>
          )}
        </button>
      </div>
    </div>
  );

  const guestForm = (
    <EmailFirstCheckout
      submitLabel={payLabel}
      onSubmit={(payload) => handleSubmit(payload)}
    />
  );

  const formFields = isLoggedIn ? loggedInForm : guestForm;

  if (embedded) return formFields;

  return (
    <div className="w-full rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900 sm:p-4">
      {hideClose ? null : (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className={`${ui.btnGhost} p-1`}
            onClick={() => { setOpen(false); setError(null); }}
            aria-label="Close booking form"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {formFields}
    </div>
  );
}

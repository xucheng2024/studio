 "use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { GiftRecipientFields, type GiftPayload } from "@/components/GiftRecipientFields";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { getBrowserSession } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type Props = {
  slug: string;
  eventId: string;
  payLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  triggerLabel?: string;
  defaultOpen?: boolean;
  hideClose?: boolean;
  embedded?: boolean;
};

export function QuickEventBookPanel({
  slug,
  eventId,
  payLabel = "Pay now",
  disabled,
  triggerClassName,
  triggerLabel,
  defaultOpen = false,
  hideClose = false,
  embedded = false,
}: Props) {
  const collapsedLabel = triggerLabel ?? payLabel;
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gift, setGift] = useState<GiftPayload | null>(null);

  useEffect(() => {
    getBrowserSession()
      .then((session) => {
        setIsLoggedIn(!!session?.user);
        setUserEmail(session?.user?.email ?? null);
      })
      .catch(() => {
        setIsLoggedIn(false);
        setUserEmail(null);
      });
  }, []);

  const handleSubmit = async (payload: EmailFirstCheckoutPayload = {}) => {
    const buyerEmail = payload.guest_email ?? userEmail ?? "";
    if (gift?.is_gift && gift.gift_recipient_email === buyerEmail.trim().toLowerCase()) {
      const msg = "Recipient email cannot be the same as your email.";
      setError(msg);
      return { ok: false as const, message: msg };
    }
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/event/book/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          event_id: eventId,
          guest_name: isLoggedIn ? undefined : payload.guest_name,
          guest_email: isLoggedIn ? undefined : payload.guest_email,
          guest_phone: isLoggedIn ? undefined : payload.guest_phone,
          ...(gift ?? {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
      if (!res.ok) {
        setError(message);
        setOpen(true);
        return { ok: false as const, message };
      }
      if (body.checkout_url) router.push(body.checkout_url);
      return { ok: true as const };
    } catch {
      const message = "Network error. Check your connection and try again.";
      setError(message);
      setOpen(true);
      return { ok: false as const, message };
    } finally {
      setLoading(false);
    }
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
          setOpen(true);
        }}
      >
        {loading ? (
          <><Loader2 size={15} className="animate-spin" /> Processing…</>
        ) : (
          collapsedLabel
        )}
      </button>
    );
  }

  const loggedInGiftFields = (
    <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={userEmail} />
  );

  const loggedInForm = (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </p>
      ) : null}
      {loggedInGiftFields}
      <div className={embedded ? "" : ui.mobileActionBar}>
        <button
          type="button"
          disabled={loading || (gift?.is_gift === true && !gift.gift_recipient_email)}
          className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
          onClick={() => void handleSubmit()}
        >
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Processing…
            </>
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
      extraFields={({ normalizedEmail }) => (
        <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={normalizedEmail} />
      )}
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
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
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

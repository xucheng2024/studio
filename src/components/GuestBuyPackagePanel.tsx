"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { GiftRecipientFields, type GiftPayload } from "@/components/GiftRecipientFields";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function GuestBuyPackagePanel({
  packageId,
  disabled = false,
  actionLabel = "Buy package",
}: {
  packageId: string;
  disabled?: boolean;
  actionLabel?: string;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [gift, setGift] = useState<GiftPayload | null>(null);

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => {
        setIsLoggedIn(!!data.session?.user);
        setUserEmail(data.session?.user?.email ?? null);
      });
  }, []);

  const submit = async (payload: EmailFirstCheckoutPayload = {}) => {
    const buyerEmail = payload.guest_email ?? userEmail ?? "";
    if (gift?.is_gift && gift.gift_recipient_email === buyerEmail.trim().toLowerCase()) {
      setMsg("Recipient email cannot be the same as your email.");
      return { ok: false as const, message: "Recipient email cannot be the same as your email." };
    }
    try {
      setBusy(true);
      setMsg(null);
      const res = await fetch("/api/package/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_id: packageId,
          guest_name: isLoggedIn ? undefined : payload.guest_name,
          guest_email: isLoggedIn ? undefined : payload.guest_email,
          guest_phone: isLoggedIn ? undefined : payload.guest_phone,
          ...(gift ?? {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
        setMsg(message);
        return { ok: false as const, message };
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
        return { ok: true as const };
      }
      setMsg("Payment created");
      return { ok: true as const };
    } catch {
      const message = "Network error. Check your connection and try again.";
      setMsg(message);
      return { ok: false as const, message };
    } finally {
      setBusy(false);
    }
  };

  if (isLoggedIn === false) {
    return (
      <div className="w-full max-w-md flex flex-col gap-3">
        <EmailFirstCheckout
          submitLabel={actionLabel}
          busyLabel="Creating..."
          disabled={disabled}
          onSubmit={submit}
          extraFields={({ normalizedEmail }) => (
            <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={normalizedEmail} />
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={userEmail} />
      <button
        type="button"
        disabled={busy || disabled || isLoggedIn === null || (gift?.is_gift === true && !gift.gift_recipient_email)}
        className={`${ui.btnPrimary} disabled:opacity-50`}
        onClick={() => void submit()}
      >
        {busy ? <><Loader2 size={15} className="animate-spin" /> Processing…</> : disabled ? "Online payment unavailable" : actionLabel}
      </button>
      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GiftRecipientFields, type GiftPayload } from "@/components/GiftRecipientFields";
import { TermsAcceptanceField } from "@/components/TermsAcceptanceField";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { getBrowserSession } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function GuestBuyPackagePanel({
  packageId,
  studioSlug,
  disabled = false,
  actionLabel = "Buy package",
  termsVersion = null,
  termsSummary = "",
}: {
  packageId: string;
  studioSlug: string;
  disabled?: boolean;
  actionLabel?: string;
  termsVersion?: { id: string; version_label: string | null } | null;
  termsSummary?: string;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [gift, setGift] = useState<GiftPayload | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

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

  const submit = async () => {
    const buyerEmail = isLoggedIn ? (userEmail ?? "") : guestEmail;
    if (gift?.is_gift && gift.gift_recipient_email === buyerEmail.trim().toLowerCase()) {
      setMsg("Recipient email cannot be the same as your email.");
      return { ok: false as const, message: "Recipient email cannot be the same as your email." };
    }
    if (termsVersion?.id && !termsAccepted) {
      const message = "Please accept the Terms & Conditions before continuing.";
      setMsg(message);
      return { ok: false as const, message };
    }
    try {
      setBusy(true);
      setMsg(null);
      const res = await fetch("/api/package/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_id: packageId,
          slug: studioSlug,
          guest_name: isLoggedIn ? undefined : guestName.trim(),
          guest_email: isLoggedIn ? undefined : guestEmail.trim().toLowerCase(),
          guest_phone: isLoggedIn ? undefined : guestPhone.trim(),
          terms_accepted: termsAccepted,
          terms_version_id: termsVersion?.id,
          ...(gift ?? {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[package-buy] failed", { status: res.status, error: body.error, body });
        const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
        setMsg(message);
        return { ok: false as const, message };
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
        return { ok: true as const };
      }
      if (body.payment_id) {
        window.location.href = `/${encodeURIComponent(studioSlug)}/checkout/${encodeURIComponent(String(body.payment_id))}`;
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
      <form
        className="w-full max-w-md flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
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
        <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={guestEmail} />
        <TermsAcceptanceField termsVersion={termsVersion} termsSummary={termsSummary} checked={termsAccepted} onChange={setTermsAccepted} />
        <button
          type="submit"
          disabled={busy || disabled || !guestName.trim() || !guestEmail.trim() || !guestPhone.trim() || (Boolean(termsVersion?.id) && !termsAccepted) || (gift?.is_gift === true && !gift.gift_recipient_email)}
          className={`${ui.btnPrimary} disabled:opacity-50`}
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Processing...</> : disabled ? "Online payment unavailable" : actionLabel}
        </button>
        {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
      </form>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={userEmail} />
      <TermsAcceptanceField termsVersion={termsVersion} termsSummary={termsSummary} checked={termsAccepted} onChange={setTermsAccepted} />
      <button
        type="button"
        disabled={busy || disabled || isLoggedIn === null || (Boolean(termsVersion?.id) && !termsAccepted) || (gift?.is_gift === true && !gift.gift_recipient_email)}
        className={`${ui.btnPrimary} disabled:opacity-50`}
        onClick={() => void submit()}
      >
        {busy ? <><Loader2 size={15} className="animate-spin" /> Processing…</> : disabled ? "Online payment unavailable" : actionLabel}
      </button>
      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </div>
  );
}

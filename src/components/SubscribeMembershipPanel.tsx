"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function SubscribeMembershipPanel({
  membershipId,
  studioSlug,
  disabled,
  intro,
}: {
  membershipId: string;
  studioSlug: string;
  disabled?: boolean;
  intro?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setIsLoggedIn(!!data.session?.user));
  }, []);

  const start = async (payload: EmailFirstCheckoutPayload = {}) => {
    setBusy(true);
    const res = await fetch("/api/membership/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        membership_id: membershipId,
        slug: studioSlug,
        guest_name: isLoggedIn ? undefined : payload.guest_name,
        guest_email: isLoggedIn ? undefined : payload.guest_email,
        guest_phone: isLoggedIn ? undefined : payload.guest_phone,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (body.error === "subscription_exists") {
        toast.info("You already have an active or pending membership for this plan.");
        return { ok: false as const, message: "You already have an active or pending membership for this plan." };
      }
      if (body.error === "guest_details_required") {
        toast.error("Please enter your name, email, and phone number.");
        return { ok: false as const, message: "Please enter your name, email, and phone number." };
      }
      const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
      toast.error(message);
      return { ok: false as const, message };
    }
    if (body.checkout_url) {
      window.location.href = body.checkout_url;
    }
    return { ok: true as const };
  };

  return (
    <div className="space-y-3">
      <p className={`text-sm ${ui.muted}`}>
        {intro ??
          "You’ll open HitPay to add a card for automatic renewals. One-time studio payments may still use PayNow elsewhere."}
      </p>
      {isLoggedIn === false ? (
        <EmailFirstCheckout
          submitLabel="Start membership"
          busyLabel="Continuing..."
          disabled={disabled}
          onSubmit={(payload) => start(payload)}
        />
      ) : null}
      {isLoggedIn !== false ? <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || disabled || isLoggedIn === null}
          className={ui.btnPrimary}
          onClick={() => void start()}
        >
          {busy ? "Continuing…" : "Start membership"}
        </button>
      </div> : null}
    </div>
  );
}

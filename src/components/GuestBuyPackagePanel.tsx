"use client";

import { useEffect, useState } from "react";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function GuestBuyPackagePanel({ packageId, disabled = false }: { packageId: string; disabled?: boolean }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setIsLoggedIn(!!data.session?.user));
  }, []);

  const submit = async (payload: EmailFirstCheckoutPayload = {}) => {
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
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
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
  };

  if (isLoggedIn === false) {
    return (
      <div className="w-full max-w-md">
        <EmailFirstCheckout submitLabel="Buy package" busyLabel="Creating..." disabled={disabled} onSubmit={submit} />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <button
        type="button"
        disabled={busy || disabled || isLoggedIn === null}
        className={`${ui.btnPrimary} disabled:opacity-50`}
        onClick={() => void submit()}
      >
        {busy ? "Creating..." : disabled ? "Online payment unavailable" : "Buy package"}
      </button>
      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </div>
  );
}

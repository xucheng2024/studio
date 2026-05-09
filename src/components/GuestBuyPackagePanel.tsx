"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function GuestBuyPackagePanel({ packageId, disabled = false }: { packageId: string; disabled?: boolean }) {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setIsLoggedIn(!!data.session?.user));
  }, []);

  const friendly = (body: { error?: string }) => {
    if (body.error === "guest_details_required") return "Please enter your name, email, and phone number.";
    if (body.error === "hitpay_not_configured") return "Online payment is not configured for this studio yet.";
    return body.error ?? "Failed";
  };

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
      const message = friendly(body);
      setMsg(message);
      return { ok: false as const, message };
    }
    if (body.checkout_url) {
      router.push(body.checkout_url);
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
      {isLoggedIn ? <p className={`text-sm ${ui.muted}`}>You are signed in. Continue to payment.</p> : null}
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

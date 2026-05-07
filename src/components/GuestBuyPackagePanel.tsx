"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function GuestBuyPackagePanel({ packageId, disabled = false }: { packageId: string; disabled?: boolean }) {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setIsLoggedIn(!!data.session?.user));
  }, []);

  return (
    <form
      className="flex w-full max-w-md flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const res = await fetch("/api/package/buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            package_id: packageId,
            guest_name: isLoggedIn ? undefined : name,
            guest_email: isLoggedIn ? undefined : email,
            guest_phone: isLoggedIn ? undefined : (phone.trim() || null),
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          if (body.error === "guest_details_required") {
            setMsg("Please enter your name, email, and phone number.");
          } else if (body.error === "hitpay_not_configured") {
            setMsg("Online payment is not configured for this studio yet.");
          } else {
            setMsg(body.error ?? "Failed");
          }
          return;
        }
        if (body.checkout_url) {
          router.push(body.checkout_url);
          return;
        }
        setMsg("Payment created");
      }}
    >
      {isLoggedIn ? (
        <p className={`text-sm ${ui.muted}`}>You are signed in. Click below to proceed to payment.</p>
      ) : (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Your name"
            className={ui.input}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
            placeholder="Email"
            className={ui.input}
          />
          <PhoneNumberInput value={phone} onChange={setPhone} placeholder="9123 4567" required />
        </>
      )}
      <button
        type="submit"
        disabled={busy || disabled || (!isLoggedIn && (!name.trim() || !email.trim() || !phone.trim()))}
        className={`${ui.btnPrimary} disabled:opacity-50`}
      >
        {busy ? "Creating..." : disabled ? "Online payment unavailable" : "Buy package"}
      </button>
      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </form>
  );
}

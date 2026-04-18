"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

export function GuestBuyPackagePanel({ packageId, disabled = false }: { packageId: string; disabled?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
            guest_name: name,
            guest_email: email,
            guest_phone: phone || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          if (body.error === "guest_details_required") {
            setMsg("Please enter your name and email.");
          } else if (body.error === "PAYNOW_NOT_CONFIGURED") {
            setMsg("PayNow is not configured for this studio yet.");
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
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        className={ui.input}
      />
      <button type="submit" disabled={busy || disabled} className={`${ui.btnPrimary} disabled:opacity-50`}>
        {busy ? "Creating..." : disabled ? "PayNow unavailable" : "Buy as guest"}
      </button>
      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </form>
  );
}


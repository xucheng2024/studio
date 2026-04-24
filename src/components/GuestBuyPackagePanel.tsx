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
            guest_phone: phone.trim() || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          if (body.error === "guest_details_required") {
            setMsg("Please enter your name and email.");
          } else if (body.error === "sign_in_required_for_package") {
            setMsg("Please sign in before purchasing a package.");
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
      <div className="flex items-center overflow-hidden rounded-lg border border-stone-300 bg-white focus-within:ring-2 focus-within:ring-teal-500 dark:border-stone-700 dark:bg-stone-900">
        <span className="select-none border-r border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
          +65
        </span>
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
          placeholder="9123 4567"
          autoComplete="tel-national"
          maxLength={8}
          className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-stone-400"
        />
      </div>
      <button type="submit" disabled={busy || disabled} className={`${ui.btnPrimary} disabled:opacity-50`}>
        {busy ? "Creating..." : disabled ? "Online payment unavailable" : "Buy as guest"}
      </button>
      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </form>
  );
}

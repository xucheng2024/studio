"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { ui } from "@/lib/ui";

export function MemberZoneUnlockPanel(props: {
  studioSlug: string;
  seriesSlug: string;
  seriesId: string;
  lessonId?: string | null;
  mode: "membership_only" | "purchase";
  amountLabel?: string;
  isAuthenticated?: boolean;
  membershipHref?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(Boolean(props.isAuthenticated));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const membershipHref = props.membershipHref ?? "/me/memberships";

  useEffect(() => {
    setIsLoggedIn(Boolean(props.isAuthenticated));
  }, [props.isAuthenticated]);

  const startPurchase = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/member-zone/purchase/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        series_id: props.seriesId,
        lesson_id: props.lessonId ?? null,
        guest_name: isLoggedIn ? undefined : name,
        guest_email: isLoggedIn ? undefined : email,
        guest_phone: isLoggedIn ? undefined : (phone.trim() || null),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (body.error === "already_purchased" || body.error === "already_member") {
        window.location.reload();
        return;
      }
      if (body.error === "guest_details_required") {
        setMsg("Please enter your name, email, and phone number.");
        return;
      }
      if (body.error === "purchase_pending" && body.checkout_url) {
        window.location.href = body.checkout_url;
        return;
      }
      setMsg(String(body.error ?? "Could not continue to payment."));
      return;
    }
    if (body.checkout_url) window.location.href = body.checkout_url;
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        {props.mode === "membership_only"
          ? "Subscribe to unlock"
          : `Buy ${props.amountLabel ?? ""} or subscribe to unlock`.trim()}
      </p>
      {!isLoggedIn && props.mode === "purchase" ? (
        <div className="mt-3 grid gap-2">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              className={ui.input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              className={ui.input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Phone</span>
            <PhoneNumberInput value={phone} onChange={setPhone} placeholder="9123 4567" required />
          </label>
          <p className="text-xs text-amber-800 dark:text-amber-200">
            We&apos;ll create your access automatically after checkout.
          </p>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {props.mode === "purchase" ? (
          <button
            type="button"
            disabled={busy || (!isLoggedIn && (!name.trim() || !email.trim() || !phone.trim()))}
            className={ui.btnPrimarySm}
            onClick={() => void startPurchase()}
          >
            {busy ? "Processing..." : `Buy ${props.amountLabel ?? ""}`.trim()}
          </button>
        ) : (
          <Link href={membershipHref} className={ui.btnPrimarySm}>
            Subscribe to unlock
          </Link>
        )}
        <Link href={membershipHref} className={ui.btnSecondarySm}>
          View membership plans
        </Link>
      </div>
      {msg ? <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{msg}</p> : null}
    </div>
  );
}

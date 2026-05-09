"use client";

import Link from "next/link";
import { useState } from "react";
import { Lock } from "lucide-react";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { ui } from "@/lib/ui";

export function MemberZoneUnlockPanel(props: {
  studioSlug: string;
  seriesSlug: string;
  seriesId: string;
  lessonId?: string | null;
  mode: "member_only" | "paid_only" | "member_or_paid";
  amountLabel?: string;
  isAuthenticated?: boolean;
  membershipHref?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isLoggedIn = Boolean(props.isAuthenticated);
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const membershipHref = props.membershipHref ?? "/me/memberships";

  const startPurchase = async () => {
    if (!isLoggedIn && !showGuestForm) {
      setShowGuestForm(true);
      return;
    }
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
        setShowGuestForm(true);
        setMsg("Please fill in all fields.");
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

  const showPurchaseButton = props.mode !== "member_only";
  const showMembershipLink = props.mode !== "paid_only";

  const headline =
    props.mode === "member_only"
      ? "Subscribe to unlock"
      : props.mode === "paid_only"
        ? `Buy to unlock · ${props.amountLabel ?? ""}`
        : `Unlock · ${props.amountLabel ?? ""}`;

  const subtext =
    props.mode === "member_only"
      ? "This lesson is for members only."
      : props.mode === "paid_only"
        ? "One-time purchase — yours to keep."
        : "Buy once, or unlock everything with a membership.";

  return (
    <div className="rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/70 to-white px-4 py-4 dark:border-teal-900/40 dark:from-teal-950/30 dark:to-stone-900/60">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">
          <Lock size={14} />
        </div>
        <div>
          <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">{headline}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">{subtext}</p>
        </div>
      </div>

      {/* Guest form — revealed on "Buy" click for non-logged-in users */}
      {showGuestForm && !isLoggedIn && showPurchaseButton ? (
        <div className="mt-4 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
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
          </div>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Phone</span>
            <PhoneNumberInput value={phone} onChange={setPhone} placeholder="9123 4567" required />
          </label>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            Your access account will be created automatically after payment.
          </p>
        </div>
      ) : null}

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {showPurchaseButton ? (
          <button
            type="button"
            disabled={busy || (showGuestForm && !isLoggedIn && (!name.trim() || !email.trim() || !phone.trim()))}
            className={ui.btnPrimarySm}
            onClick={() => void startPurchase()}
          >
            {busy
              ? "Processing…"
              : showGuestForm || isLoggedIn
                ? `Buy · ${props.amountLabel ?? ""}`
                : "Buy Now"}
          </button>
        ) : null}
        {showMembershipLink ? (
          <Link
            href={membershipHref}
            className={
              props.mode === "member_only"
                ? ui.btnPrimarySm
                : ui.btnSecondarySm
            }
          >
            {props.mode === "member_only" ? "Become a Member" : "Become a Member"}
          </Link>
        ) : null}
      </div>

      {msg ? <p className={`mt-2 text-xs ${ui.error}`}>{msg}</p> : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { createBrowserSupabase } from "@/lib/supabase/client";
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
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  /** Browser session can disagree with SSR `isAuthenticated` (CDN/cache). */
  const [browserLoggedIn, setBrowserLoggedIn] = useState<boolean | null>(null);
  const isLoggedInUi = Boolean(props.isAuthenticated) || browserLoggedIn === true;
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const membershipHref = props.membershipHref ?? "/me/memberships";

  useEffect(() => {
    let cancelled = false;
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setBrowserLoggedIn(Boolean(data.session?.user));
      })
      .catch(() => {
        if (!cancelled) setBrowserLoggedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Match package buy: trust HitPay absolute URLs; validate with URL() instead of a strict regex. */
  function goToCheckout(url: unknown) {
    const raw = String(url ?? "").trim();
    if (!raw) {
      const bad = "Checkout could not be started. Please try again.";
      setMsg(bad);
      toast.error(bad);
      return;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        const bad = "Checkout link was invalid. Please try again.";
        setMsg(bad);
        toast.error(bad);
        return;
      }
      window.location.href = parsed.href;
    } catch {
      const bad = "Checkout link was invalid. Please try again.";
      setMsg(bad);
      toast.error(bad);
    }
  }

  const startPurchase = async () => {
    const supabase = createBrowserSupabase();
    let { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user && props.isAuthenticated) {
      try {
        await supabase.auth.refreshSession();
        sessionData = (await supabase.auth.getSession()).data;
      } catch {
        /* keep prior sessionData */
      }
    }
    const hasBrowserSession = Boolean(sessionData.session?.user);
    setBrowserLoggedIn(hasBrowserSession);
    if (hasBrowserSession) setShowGuestForm(false);

    if (!hasBrowserSession && !showGuestForm) {
      setShowGuestForm(true);
      setMsg("Enter your details below, then tap Buy again.");
      return;
    }
    if (!hasBrowserSession && showGuestForm) {
      if (!name.trim() || !email.trim() || !phone.trim()) {
        const hint = "Please fill in name, email, and phone to continue.";
        setMsg(hint);
        toast.error(hint);
        return;
      }
    }
    setBusy(true);
    setMsg(null);
    setDebugInfo(null);
    try {
      const res = await fetch("/api/member-zone/purchase/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series_id: props.seriesId,
          lesson_id: props.lessonId ?? null,
          guest_name: hasBrowserSession ? undefined : name,
          guest_email: hasBrowserSession ? undefined : email,
          guest_phone: hasBrowserSession ? undefined : (phone.trim() || null),
        }),
      });
      const rawText = await res.text();
      const body = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      if (!res.ok) {
        if (body.error === "already_purchased" || body.error === "already_member") {
          window.location.reload();
          return;
        }
        if (body.error === "guest_details_required") {
          setShowGuestForm(true);
          const hint = hasBrowserSession
            ? "Your login could not be verified by the server. Refresh the page or complete the form below."
            : "Please fill in all fields.";
          setMsg(hint);
          toast.error(hint);
          return;
        }
        if (body.error === "purchase_pending" && body.checkout_url) {
          goToCheckout(body.checkout_url);
          return;
        }
        const errText = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
        setMsg(errText);
        setDebugInfo(
          [
            `status=${res.status}`,
            `error=${String(body.error ?? "unknown")}`,
            body.error_detail ? `detail=${String(body.error_detail)}` : null,
            rawText && !body.error ? `raw=${rawText.slice(0, 300)}` : null,
          ]
            .filter(Boolean)
            .join(" | "),
        );
        toast.error(errText);
        return;
      }
      if (body.checkout_url) {
        goToCheckout(body.checkout_url);
        return;
      }
      const fallback = "Checkout could not be started. Please try again.";
      setMsg(fallback);
      setDebugInfo(`status=${res.status} | missing_checkout_url`);
      toast.error(fallback);
    } catch (error) {
      const net = "Network error. Check your connection and try again.";
      setMsg(net);
      setDebugInfo(`exception=${error instanceof Error ? error.message : "unknown_error"}`);
      toast.error(net);
    } finally {
      setBusy(false);
    }
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
    <div className="relative z-10 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/70 to-white px-4 py-4 dark:border-teal-900/40 dark:from-teal-950/30 dark:to-stone-900/60">
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

      {/* Guest form — do not gate on SSR isAuthenticated; it can disagree with getSession() (PWA / ITP / partitions). */}
      {showGuestForm && showPurchaseButton ? (
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
            disabled={busy}
            className={ui.btnPrimarySm}
            onClick={() => void startPurchase()}
          >
            {busy
              ? "Processing…"
              : showGuestForm || isLoggedInUi
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
      {debugInfo ? (
        <p className="mt-1 wrap-break-word font-mono text-[11px] text-stone-500 dark:text-stone-400">
          debug: {debugInfo}
        </p>
      ) : null}
    </div>
  );
}

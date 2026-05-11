"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type InlineState =
  | { type: "idle" }
  | { type: "exists" }
  | { type: "no_url" }
  | { type: "error"; message: string };

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
  const [inline, setInline] = useState<InlineState>({ type: "idle" });

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setIsLoggedIn(!!data.session?.user));
  }, []);

  const myMembershipsHref = `/${studioSlug}/me/memberships`;

  const start = async (payload: EmailFirstCheckoutPayload = {}) => {
    try {
      setBusy(true);
      setInline({ type: "idle" });
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
      if (!res.ok) {
        if (body.error === "subscription_exists") {
          setInline({ type: "exists" });
          return { ok: false as const, message: "subscription_exists" };
        }
        if (body.error === "guest_details_required") {
          toast.error("Please enter your name, email, and phone number.");
          return { ok: false as const, message: "Please enter your name, email, and phone number." };
        }
        const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
        const isGatewayError =
          String(body.error ?? "").startsWith("hitpay_") ||
          body.error === "hitpay_gateway_error";
        const finalMessage = isGatewayError
          ? `${message} Please try again or contact the studio if it persists.`
          : message;
        setInline({ type: "error", message: finalMessage });
        return { ok: false as const, message: finalMessage };
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
      } else {
        setInline({ type: "no_url" });
      }
      return { ok: true as const };
    } catch {
      const message = "Network error. Check your connection and try again.";
      setInline({ type: "error", message });
      return { ok: false as const, message };
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className={`text-sm ${ui.muted}`}>
        {intro ??
          "You'll open HitPay to add a card for automatic renewals. One-time studio payments may still use PayNow elsewhere."}
      </p>
      {isLoggedIn === false ? (
        <EmailFirstCheckout
          submitLabel="Start membership"
          busyLabel="Continuing..."
          disabled={disabled}
          onSubmit={(payload) => start(payload)}
        />
      ) : null}
      {isLoggedIn !== false ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || disabled || isLoggedIn === null}
            className={ui.btnPrimary}
            onClick={() => void start()}
          >
            {busy ? <><Loader2 size={15} className="animate-spin" /> Processing…</> : "Start membership"}
          </button>
        </div>
      ) : null}

      {inline.type === "exists" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300">
          You already have an active or pending membership for this plan.{" "}
          <Link href={myMembershipsHref} className="font-medium underline underline-offset-2">
            View my memberships →
          </Link>
        </div>
      )}
      {inline.type === "no_url" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
          Your membership was created but no checkout link was returned.{" "}
          <Link href={myMembershipsHref} className="font-medium underline underline-offset-2">
            Go to my memberships
          </Link>{" "}
          to continue payment or sync status.
        </div>
      )}
      {inline.type === "error" && (
        <p className={`text-sm ${ui.error}`}>{inline.message}</p>
      )}
    </div>
  );
}

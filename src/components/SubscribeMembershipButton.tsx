"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { ui } from "@/lib/ui";

type InlineState = "idle" | "exists" | "no_url";

export function SubscribeMembershipButton({
  membershipId,
  studioSlug,
  label,
}: {
  membershipId: string;
  studioSlug: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [inline, setInline] = useState<InlineState>("idle");

  const myMembershipsHref = `/${studioSlug}/me/memberships`;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setInline("idle");
    try {
      const res = await fetch("/api/membership/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId, slug: studioSlug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === "subscription_exists") {
          setInline("exists");
          return;
        }
        const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
        const isGatewayError =
          String(body.error ?? "").startsWith("hitpay_") ||
          body.error === "hitpay_gateway_error";
        toast.error(
          isGatewayError
            ? `${message} Please try again or contact the studio.`
            : message,
        );
        return;
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
      } else {
        setInline("no_url");
      }
    } catch {
      toast.error("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={busy}
        className={`${ui.btnPrimarySm} disabled:opacity-60`}
        onClick={() => void start()}
      >
        {busy ? "Continuing…" : (label ?? "Subscribe")}
      </button>
      {inline === "exists" && (
        <p className="text-right text-xs text-stone-500 dark:text-stone-400">
          You already have an active membership.{" "}
          <Link href={myMembershipsHref} className="underline underline-offset-2">
            View my memberships →
          </Link>
        </p>
      )}
      {inline === "no_url" && (
        <p className="text-right text-xs text-amber-700 dark:text-amber-400">
          No checkout link returned.{" "}
          <Link href={myMembershipsHref} className="underline underline-offset-2">
            Go to my memberships
          </Link>
        </p>
      )}
    </div>
  );
}

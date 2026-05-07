"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function SubscribeMembershipPanel({
  membershipId,
  studioSlug,
  membershipSlug,
  disabled,
  intro,
}: {
  membershipId: string;
  studioSlug: string;
  membershipSlug: string;
  disabled?: boolean;
  intro?: string;
}) {
  const [busy, setBusy] = useState(false);

  const nextPath = `/membership/${studioSlug}/${membershipSlug}`;
  const authHref = `/m/${studioSlug}/auth?next=${encodeURIComponent(nextPath)}`;

  const start = async () => {
    setBusy(true);
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      window.location.href = authHref;
      return;
    }

    const res = await fetch("/api/membership/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membership_id: membershipId, slug: studioSlug }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (body.error === "subscription_exists") {
        toast.info("You already have an active or pending membership for this plan.");
        return;
      }
      toast.error(body.error ?? "Could not start subscription");
      return;
    }
    if (body.checkout_url) {
      window.location.href = body.checkout_url;
    }
  };

  return (
    <div className="space-y-3">
      <p className={`text-sm ${ui.muted}`}>{intro ?? "Sign in to attach a payment method and start automatic billing for this membership."}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || disabled} className={ui.btnPrimary} onClick={() => void start()}>
          {busy ? "Continuing…" : "Start membership"}
        </button>
        <Link href={authHref} className={ui.btnSecondary}>
          Sign in first
        </Link>
      </div>
    </div>
  );
}

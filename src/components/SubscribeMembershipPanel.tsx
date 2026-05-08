"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setIsLoggedIn(!!data.session?.user));
  }, []);

  const start = async () => {
    setBusy(true);
    const res = await fetch("/api/membership/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        membership_id: membershipId,
        slug: studioSlug,
        guest_name: isLoggedIn ? undefined : name,
        guest_email: isLoggedIn ? undefined : email,
        guest_phone: isLoggedIn ? undefined : (phone.trim() || null),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (body.error === "subscription_exists") {
        toast.info("You already have an active or pending membership for this plan.");
        return;
      }
      if (body.error === "guest_details_required") {
        toast.error("Please enter your name, email, and phone number.");
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
      <p className={`text-sm ${ui.muted}`}>
        {intro ?? "Attach a payment method and start automatic billing for this membership."}
      </p>
      {isLoggedIn ? (
        <p className={`text-sm ${ui.muted}`}>You are signed in. We&apos;ll attach this membership to your account.</p>
      ) : (
        <div className="grid gap-3">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Name</span>
            <input
              className={ui.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              autoComplete="name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Email</span>
            <input
              type="email"
              className={ui.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Phone</span>
            <PhoneNumberInput value={phone} onChange={setPhone} placeholder="9123 4567" required />
          </label>
          <p className={`text-xs ${ui.muted}`}>We&apos;ll create your member account automatically after you continue.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || disabled || (!isLoggedIn && (!name.trim() || !email.trim() || !phone.trim()))}
          className={ui.btnPrimary}
          onClick={() => void start()}
        >
          {busy ? "Continuing…" : "Start membership"}
        </button>
      </div>
    </div>
  );
}

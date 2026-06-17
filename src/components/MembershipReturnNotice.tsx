"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { ui } from "@/lib/ui";

/**
 * Shown when HitPay redirects back to the membership page after checkout (`?membership_checkout=1`).
 * Auto-syncs with HitPay then redirects to /me/memberships so the user sees their activated membership.
 */
export function MembershipReturnNotice({ studioSlug }: { studioSlug: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const visible = sp.get("membership_checkout") === "1";
  const subscriptionId = sp.get("subscription_id")?.trim() ?? "";
  const [syncing, setSyncing] = useState(() => visible && Boolean(subscriptionId));
  const syncedRef = useRef(false);

  const myMembershipsHref = `/${studioSlug}/me/memberships`;

  useEffect(() => {
    if (!subscriptionId || syncedRef.current) return;
    syncedRef.current = true;
    let cancelled = false;
    void fetch("/api/membership/sync-from-hitpay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription_id: subscriptionId }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({})) as { subscription_status?: string | null };
        // Only redirect if sync succeeded — lets user stay on page if they cancelled HitPay
        if (res.ok && body.subscription_status && body.subscription_status !== "scheduled") {
          router.push(myMembershipsHref);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setSyncing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [myMembershipsHref, router, subscriptionId]);

  const stripQuery = () => {
    const membershipSlug = typeof window !== "undefined"
      ? window.location.pathname.split("/").filter(Boolean).pop() ?? ""
      : "";
    router.replace(`/${studioSlug}/memberships/${membershipSlug}`);
  };

  if (!visible) return null;

  return (
    <div
      className="mb-6 flex gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 dark:border-teal-800/50 dark:bg-teal-950/35"
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-teal-900 dark:text-teal-100">
          {syncing ? <Loader2 size={14} className="animate-spin" /> : null}
          {syncing ? "Confirming your membership…" : "Back from HitPay"}
        </p>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          {syncing
            ? "Checking your payment status with HitPay. You'll be redirected to your membership page automatically."
            : <>
                If you completed checkout, view your membership under{" "}
                <Link href={myMembershipsHref} className={ui.link}>
                  My memberships
                </Link>
                . If you didn&apos;t finish, you can try again below.
              </>
          }
        </p>
      </div>
      {!syncing ? (
        <button
          type="button"
          className={`shrink-0 rounded-lg p-1 ${ui.muted} hover:bg-teal-100 dark:hover:bg-teal-900/40`}
          aria-label="Dismiss"
          onClick={() => {
            stripQuery();
          }}
        >
          <X size={18} />
        </button>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ui } from "@/lib/ui";

/**
 * Shown when HitPay redirects back to the membership page after checkout (`?membership_checkout=1`).
 */
export function MembershipReturnNotice({ studioSlug }: { studioSlug: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const syncedRef = useRef(false);

  useEffect(() => {
    if (sp.get("membership_checkout") !== "1") return;
    setVisible(true);

    const subscriptionId = sp.get("subscription_id")?.trim();
    if (!subscriptionId || syncedRef.current) return;
    syncedRef.current = true;
    void fetch("/api/membership/sync-from-hitpay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription_id: subscriptionId }),
    }).catch(() => {});
  }, [sp]);

  if (!visible) return null;

  const membershipSlug = typeof window !== "undefined" ? window.location.pathname.split("/").filter(Boolean).pop() ?? "" : "";

  const stripQuery = () => {
    const path = `/${studioSlug}/memberships/${membershipSlug}`;
    router.replace(path);
  };

  return (
    <div
      className={`mb-6 flex gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 dark:border-teal-800/50 dark:bg-teal-950/35`}
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-teal-900 dark:text-teal-100">Back from HitPay</p>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          If you finished the steps on HitPay, your membership will appear under{" "}
          <Link href={`/${studioSlug}/me/memberships`} className={ui.link}>
            My memberships
          </Link>{" "}
          shortly. Refresh that page if you don&apos;t see it yet.
        </p>
      </div>
      <button
        type="button"
        className={`shrink-0 rounded-lg p-1 ${ui.muted} hover:bg-teal-100 dark:hover:bg-teal-900/40`}
        aria-label="Dismiss"
        onClick={() => {
          setVisible(false);
          stripQuery();
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}

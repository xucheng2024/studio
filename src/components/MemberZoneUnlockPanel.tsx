"use client";

import Link from "next/link";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function MemberZoneUnlockPanel(props: {
  studioSlug: string;
  seriesSlug: string;
  seriesId: string;
  lessonId?: string | null;
  mode: "membership_only" | "purchase";
  amountLabel?: string;
  isAuthenticated?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const nextPath = `/member-zone/${props.studioSlug}/${props.seriesSlug}`;
  const authHref = `/m/${props.studioSlug}/auth?next=${encodeURIComponent(nextPath)}`;
  const membershipAnchor = `/${props.studioSlug}#memberships`;

  const startPurchase = async () => {
    setBusy(true);
    setMsg(null);
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      window.location.href = authHref;
      return;
    }
    const res = await fetch("/api/member-zone/purchase/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        series_id: props.seriesId,
        lesson_id: props.lessonId ?? null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (body.error === "already_purchased" || body.error === "already_member") {
        window.location.reload();
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
          ? "订阅会员解锁"
          : `单独购买 ${props.amountLabel ?? ""} 或订阅会员解锁`.trim()}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.mode === "purchase" ? (
          <button
            type="button"
            disabled={busy}
            className={ui.btnPrimarySm}
            onClick={() => void startPurchase()}
          >
            {busy ? "Processing..." : `单独购买 ${props.amountLabel ?? ""}`.trim()}
          </button>
        ) : props.isAuthenticated ? (
          <Link href={membershipAnchor} className={ui.btnPrimarySm}>
            订阅会员解锁
          </Link>
        ) : (
          <Link href={authHref} className={ui.btnPrimarySm}>
            登录后解锁
          </Link>
        )}
        <Link href={membershipAnchor} className={ui.btnSecondarySm}>
          查看会员计划
        </Link>
      </div>
      {msg ? <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{msg}</p> : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleUserRound, X } from "lucide-react";
import { InlineSignInPanel } from "@/components/InlineSignInPanel";
import { SignOutButton } from "@/components/SignOutButton";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function StudioAccountEntry({
  isSignedIn,
}: {
  isSignedIn?: boolean;
}) {
  const [showSignIn, setShowSignIn] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(typeof isSignedIn === "boolean" ? isSignedIn : null);

  useEffect(() => {
    if (signedIn !== null) return;
    let cancelled = false;
    const supabase = createBrowserSupabase();
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setSignedIn(Boolean(data.session?.user));
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (signedIn) {
    return (
      <details className="relative">
        <summary
          aria-label="Account"
          className="inline-flex size-9 list-none items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
        >
          <CircleUserRound size={18} />
        </summary>
        <div className="absolute right-0 top-11 z-50 min-w-52 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900">
          <Link href="/me/bookings" className={ui.linkHeaderMenu}>
            My bookings
          </Link>
          <Link href="/me/class-passes" className={ui.linkHeaderMenu}>
            My packages
          </Link>
          <Link href="/me/orders" className={ui.linkHeaderMenu}>
            My orders
          </Link>
          <Link href="/me/profile" className={ui.linkHeaderMenu}>
            Profile
          </Link>
          <Link href="/me/memberships" className={ui.linkHeaderMenu}>
            My memberships
          </Link>
          <div className={`mt-1 border-t ${ui.divider} pt-1`}>
            <SignOutButton />
          </div>
        </div>
      </details>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="Account"
        className="inline-flex size-9 items-center justify-center rounded-full border border-teal-300 bg-teal-50 text-teal-700 shadow-sm transition hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-900/40"
        onClick={() => setShowSignIn(true)}
      >
        <CircleUserRound size={18} />
      </button>

      {showSignIn ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowSignIn(false)}>
          <div className="relative w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close sign-in"
              className={`${ui.btnGhost} absolute -top-10 right-0 border border-white/30 bg-black/30 text-white hover:bg-black/50`}
              onClick={() => setShowSignIn(false)}
            >
              <X size={14} />
              Close
            </button>
            <InlineSignInPanel defaultOpen hideTrigger />
          </div>
        </div>
      ) : null}
    </>
  );
}

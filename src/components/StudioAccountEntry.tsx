"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleUserRound, X } from "lucide-react";
import { InlineSignInPanel } from "@/components/InlineSignInPanel";
import { SignOutButton } from "@/components/SignOutButton";
import { studioMePath } from "@/lib/public-paths";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export function StudioAccountEntry({
  isSignedIn,
  studioSlug,
  showMembershipsLink,
}: {
  isSignedIn?: boolean;
  studioSlug: string;
  showMembershipsLink?: boolean;
}) {
  const [showSignIn, setShowSignIn] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean>(Boolean(isSignedIn));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Stay in sync with Supabase auth state reactively (handles post-login refresh)
  useEffect(() => {
    const supabase = createBrowserSupabase();
    // Seed current state
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session?.user));
    }).catch(() => null);
    // React to future changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nowSignedIn = Boolean(session?.user);
      setSignedIn(nowSignedIn);
      if (nowSignedIn) setShowSignIn(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  if (signedIn) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          aria-label="Account"
          aria-expanded={menuOpen}
          className="inline-flex size-9 list-none items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <CircleUserRound size={18} />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-11 z-50 min-w-52 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900">
            <Link href={studioMePath(studioSlug, "bookings")} className={ui.linkHeaderMenu} onClick={() => setMenuOpen(false)}>
              My bookings
            </Link>
            <Link href={studioMePath(studioSlug, "class-passes")} className={ui.linkHeaderMenu} onClick={() => setMenuOpen(false)}>
              My packages
            </Link>
            <Link href={studioMePath(studioSlug, "orders")} className={ui.linkHeaderMenu} onClick={() => setMenuOpen(false)}>
              My orders
            </Link>
            <Link href={studioMePath(studioSlug, "profile")} className={ui.linkHeaderMenu} onClick={() => setMenuOpen(false)}>
              Profile
            </Link>
            {showMembershipsLink !== false ? (
              <Link href={studioMePath(studioSlug, "memberships")} className={ui.linkHeaderMenu} onClick={() => setMenuOpen(false)}>
                My memberships
              </Link>
            ) : null}
            <div className={`mt-1 border-t ${ui.divider} pt-1`}>
              <SignOutButton />
            </div>
          </div>
        ) : null}
      </div>
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
              aria-label="Close"
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

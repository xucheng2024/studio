"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MobileMenu } from "@/components/MobileMenu";
import { SiteHeaderAccountDropdown } from "@/components/SiteHeaderAccountDropdown";
import { site } from "@/lib/brand";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { studioClassesPath, studioMePath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type NavItem = { href: string; label: string };

type HeaderNavPayload = {
  isLoggedIn: boolean;
  hasBackofficeAccess: boolean;
  userInitial: string | null;
  showMembershipsLink: boolean;
};

function readCookieValue(name: string) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(prefix));
  if (!match) return "";
  return decodeURIComponent(match.slice(prefix.length));
}

function parseHeaderNavPayload(json: unknown): HeaderNavPayload | null {
  if (!json || typeof json !== "object") return null;
  const row = json as Record<string, unknown>;
  return {
    isLoggedIn: Boolean(row.isLoggedIn),
    hasBackofficeAccess: Boolean(row.hasBackofficeAccess),
    userInitial: typeof row.userInitial === "string" ? row.userInitial : null,
    showMembershipsLink: Boolean(row.showMembershipsLink),
  };
}

export function SiteHeaderConfigured() {
  const pathname = usePathname() ?? "";
  const [ready, setReady] = useState(false);
  const [navEpoch, setNavEpoch] = useState(0);
  const activeStudioSlug = normalizeStudioSlug(readCookieValue(ACTIVE_MEMBER_STUDIO_COOKIE)) ?? "";
  const [payload, setPayload] = useState<HeaderNavPayload>({
    isLoggedIn: false,
    hasBackofficeAccess: false,
    userInitial: null,
    showMembershipsLink: false,
  });

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setNavEpoch((n) => n + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetch("/api/me/header-nav")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!mounted) return;
        const parsed = parseHeaderNavPayload(json);
        if (parsed) setPayload(parsed);
      })
      .catch(() => null)
      .finally(() => {
        if (mounted) {
          setReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [pathname, navEpoch]);

  const isDashboardPath = pathname.startsWith("/dashboard");
  const brandHref = isDashboardPath
    ? "/dashboard"
    : activeStudioSlug
      ? `/${activeStudioSlug}`
      : "/";
  const inStudioContext = !isDashboardPath && Boolean(activeStudioSlug);
  const memberNavItems = useMemo<NavItem[]>(
    () =>
      activeStudioSlug
        ? [
            { href: studioMePath(activeStudioSlug, "bookings"), label: "My bookings" },
            { href: studioMePath(activeStudioSlug, "class-passes"), label: "My packages" },
            { href: studioMePath(activeStudioSlug, "orders"), label: "My orders" },
            { href: studioMePath(activeStudioSlug, "profile"), label: "Profile" },
            ...(payload.showMembershipsLink
              ? [{ href: studioMePath(activeStudioSlug, "memberships"), label: "My memberships" }]
              : []),
          ]
        : [
            { href: "/me/bookings", label: "My bookings" },
            { href: "/me/class-passes", label: "My packages" },
            { href: "/me/orders", label: "My orders" },
            { href: "/me/profile", label: "Profile" },
            ...(payload.showMembershipsLink ? [{ href: "/me/memberships", label: "My memberships" }] : []),
          ],
    [activeStudioSlug, payload.showMembershipsLink],
  );

  const navItems = useMemo(() => {
    if (!payload.isLoggedIn) {
      return [{ href: activeStudioSlug ? studioClassesPath(activeStudioSlug) : "/", label: "Classes" }];
    }
    if (!payload.hasBackofficeAccess) return memberNavItems;
    if (!inStudioContext) return [{ href: "/dashboard", label: "Dashboard" }];
    return [{ href: "/dashboard", label: "Dashboard" }, ...memberNavItems];
  }, [activeStudioSlug, inStudioContext, memberNavItems, payload.hasBackofficeAccess, payload.isLoggedIn]);

  return (
    <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <Link href={brandHref} className={ui.linkHeaderBrand}>
        {site.name}
      </Link>
      {!ready ? (
        <>
          <nav className="hidden items-center gap-2 sm:flex" aria-hidden>
            <span className="h-8 w-20 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-700/60" />
            <span className="h-8 w-24 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-700/60" />
            <span className="h-8 w-20 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-700/60" />
            <span className="ml-1 inline-flex size-7 animate-pulse rounded-full bg-stone-200/80 dark:bg-stone-700/60" />
          </nav>
          <div className="flex items-center gap-2 sm:hidden" aria-hidden>
            <span className="inline-flex size-7 animate-pulse rounded-full bg-stone-200/80 dark:bg-stone-700/60" />
            <span className="inline-flex size-9 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-700/60" />
          </div>
        </>
      ) : (
        <>
          <nav className="hidden items-center gap-1 sm:flex">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={ui.linkHeaderNav}>
                {item.label}
              </Link>
            ))}
            {payload.isLoggedIn ? (
              <SiteHeaderAccountDropdown userInitial={payload.userInitial ?? "U"} navItems={navItems} />
            ) : (
              <Link href="/auth" className={`${ui.btnPrimarySm} ml-1 py-1!`}>
                Sign in
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2 sm:hidden">
            {payload.isLoggedIn && (
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-100">
                {payload.userInitial ?? "U"}
              </span>
            )}
            <MobileMenu navItems={navItems} isLoggedIn={payload.isLoggedIn} />
          </div>
        </>
      )}
    </div>
  );
}

/** @deprecated Use SiteHeaderConfigured — kept for any direct imports */
export const SiteHeaderClientNav = SiteHeaderConfigured;

"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  CalendarRange,
  Package,
  Users,
  CreditCard,
  BarChart2,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { isRouteActive, pathFromHref } from "@/lib/nav-active";

type NavLink = { href: string; label: string; icon: LucideIcon };

const links: NavLink[] = [
  { href: "/dashboard/operations", label: "Operations", icon: LayoutDashboard },
  { href: "/dashboard/payments",   label: "Payments",   icon: CreditCard },
  { href: "/dashboard/schedule",   label: "Schedule",   icon: Calendar },
  { href: "/dashboard/packages",   label: "Packages",   icon: Package },
  { href: "/dashboard/events",     label: "Events",     icon: CalendarRange },
  { href: "/dashboard/clients",    label: "Members",    icon: Users },
  { href: "/dashboard/reports",    label: "Reports",    icon: BarChart2 },
  { href: "/dashboard/settings",   label: "Settings",   icon: Settings },
];

const roleLinkAllowList: Record<"owner" | "manager" | "frontdesk", string[]> = {
  owner:     links.map((l) => l.href),
  manager:   links.map((l) => l.href),
  frontdesk: ["/dashboard/operations", "/dashboard/payments", "/dashboard/schedule", "/dashboard/packages", "/dashboard/events", "/dashboard/clients"],
};

function useVisibleLinks(
  role: "owner" | "manager" | "frontdesk",
  superAdminNoStudioMode: boolean,
) {
  const allowed = new Set(roleLinkAllowList[role]);
  return superAdminNoStudioMode
    ? links.filter((l) => l.href === "/dashboard/settings")
    : links.filter((l) => allowed.has(l.href));
}

function useNavState() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const keep = new URLSearchParams();
  for (const key of [
    "studio_id", "location_id", "date_from", "date_to",
    "payment_method", "q",
  ]) {
    const v = search.get(key);
    if (v) keep.set(key, v);
  }

  useEffect(() => {
    startTransition(() => setPendingHref(null));
  }, [pathname]);

  return { pathname, keep, pendingHref, setPendingHref };
}

/* ── Desktop sidebar nav ─────────────────────────────────────────── */
export function DashboardNav({
  role,
  superAdminNoStudioMode = false,
}: {
  role: "owner" | "manager" | "frontdesk";
  superAdminNoStudioMode?: boolean;
}) {
  const visibleLinks = useVisibleLinks(role, superAdminNoStudioMode);
  const { pathname, keep, pendingHref, setPendingHref } = useNavState();

  return (
    <nav className="flex flex-col gap-0.5">
      {visibleLinks.map((l) => {
        const active = isRouteActive(pathname, l.href);
        const href = keep.toString() ? `${l.href}?${keep.toString()}` : l.href;
        const navigating = pendingHref === pathFromHref(l.href) && !active;
        const Icon = l.icon;

        return (
          <Link
            key={l.href}
            href={href}
            prefetch
            onClick={() => { if (active) return; setPendingHref(pathFromHref(l.href)); }}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-[color,background-color,opacity] duration-100 active:scale-[0.98] active:opacity-90 ${
              active
                ? "bg-teal-600 text-white shadow-sm shadow-teal-600/30"
                : navigating
                  ? "bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-100"
                  : "text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            }`}
          >
            <Icon size={15} className="shrink-0" strokeWidth={active ? 2.2 : 1.8} />
            <span>{navigating ? `${l.label}…` : l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ── Mobile bottom tab bar ───────────────────────────────────────── */
export function MobileBottomNav({
  role,
  superAdminNoStudioMode = false,
}: {
  role: "owner" | "manager" | "frontdesk";
  superAdminNoStudioMode?: boolean;
}) {
  const visibleLinks = useVisibleLinks(role, superAdminNoStudioMode);
  const { pathname, keep, pendingHref, setPendingHref } = useNavState();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-stone-200/80 bg-white/90 backdrop-blur-xl md:hidden dark:border-stone-800/80 dark:bg-stone-950/90"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {visibleLinks.map((l) => {
        const active = isRouteActive(pathname, l.href);
        const href = keep.toString() ? `${l.href}?${keep.toString()}` : l.href;
        const navigating = pendingHref === pathFromHref(l.href) && !active;
        const Icon = l.icon;

        return (
          <Link
            key={l.href}
            href={href}
            prefetch
            onClick={() => { if (active) return; setPendingHref(pathFromHref(l.href)); }}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[10px] font-medium transition-[color,opacity] duration-100 active:opacity-70 ${
              active
                ? "text-teal-600 dark:text-teal-400"
                : navigating
                  ? "text-teal-500 dark:text-teal-500"
                  : "text-stone-500 dark:text-stone-500"
            }`}
          >
            <Icon
              size={20}
              strokeWidth={active ? 2.2 : 1.7}
              className={active ? "text-teal-600 dark:text-teal-400" : ""}
            />
            <span>{navigating ? "…" : l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

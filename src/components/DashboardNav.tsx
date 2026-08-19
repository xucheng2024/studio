"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  Film,
  ShoppingBag,
  BriefcaseBusiness,
  Package,
  Repeat,
  Users,
  ReceiptText,
  CreditCard,
  BarChart2,
  Mail,
  Settings,
  Wallet,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { usePkgApprovalsOverdueBadge } from "@/components/dashboard/pkg-approvals-overdue-badge";
import { isRouteActive, pathFromHref } from "@/lib/nav-active";
import { ui } from "@/lib/ui";

type NavLink = { href: string; label: string; icon: LucideIcon };

const links: NavLink[] = [
  { href: "/dashboard/operations", label: "Front desk", icon: ClipboardList },
  { href: "/dashboard/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
  { href: "/dashboard/payments",   label: "Payments",   icon: CreditCard },
  { href: "/dashboard/pos",        label: "POS",        icon: ReceiptText },
  { href: "/dashboard/services",   label: "Services",   icon: BriefcaseBusiness },
  { href: "/dashboard/schedule",   label: "Class sessions", icon: CalendarClock },
  { href: "/dashboard/events",     label: "Events",     icon: CalendarRange },
  { href: "/dashboard/member-zone",label: "Member zone",icon: Film },
  { href: "/dashboard/shop",       label: "Shop",       icon: ShoppingBag },
  { href: "/dashboard/packages",   label: "Packages",   icon: Package },
  { href: "/dashboard/memberships",label: "Memberships",icon: Repeat },
  { href: "/dashboard/clients",    label: "Customers",  icon: Users },
  { href: "/dashboard/marketing",  label: "Marketing",  icon: Mail },
  { href: "/dashboard/payroll",    label: "Payroll",    icon: Wallet },
  { href: "/dashboard/payroll/me", label: "My pay",     icon: Wallet },
  { href: "/dashboard/reports",    label: "Reports",    icon: BarChart2 },
  { href: "/dashboard/settings",   label: "Settings",   icon: Settings },
];

const roleLinkAllowList: Record<"owner" | "manager" | "frontdesk" | "instructor", string[]> = {
  owner:     links.map((l) => l.href).filter((href) => href !== "/dashboard/payroll/me"),
  manager:   links.map((l) => l.href).filter((href) => href !== "/dashboard/payroll" && href !== "/dashboard/payroll/me"),
  frontdesk: ["/dashboard/operations", "/dashboard/appointments", "/dashboard/payments", "/dashboard/pos", "/dashboard/schedule", "/dashboard/events", "/dashboard/packages", "/dashboard/memberships", "/dashboard/clients", "/dashboard/payroll/me"],
  instructor: ["/dashboard/appointments", "/dashboard/payroll/me"],
};

const MOBILE_PRIMARY_HREFS = [
  "/dashboard/operations",
  "/dashboard/appointments",
  "/dashboard/pos",
  "/dashboard/clients",
];

function useVisibleLinks(
  role: "owner" | "manager" | "frontdesk" | "instructor",
  superAdminNoStudioMode: boolean,
) {
  const allowed = new Set(roleLinkAllowList[role]);
  return superAdminNoStudioMode
    ? links.filter((l) => l.href === "/dashboard/settings")
    : links.filter((l) => allowed.has(l.href));
}

function splitMobileLinks(visibleLinks: NavLink[]) {
  if (visibleLinks.length <= 4) {
    return { primary: visibleLinks, more: [] as NavLink[] };
  }
  const byHref = new Map(visibleLinks.map((link) => [link.href, link]));
  const primary = MOBILE_PRIMARY_HREFS.map((href) => byHref.get(href)).filter(
    (link): link is NavLink => Boolean(link),
  );
  const primarySet = new Set(primary.map((link) => link.href));
  const more = visibleLinks.filter((link) => !primarySet.has(link.href));
  return { primary, more };
}

function isPayrollNavActive(pathname: string, href: string) {
  if (href === "/dashboard/payroll" && (pathname === "/dashboard/payroll/me" || pathname.startsWith("/dashboard/payroll/me/"))) {
    return false;
  }
  return isRouteActive(pathname, href);
}

function useNavState() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const keep = new URLSearchParams();
  for (const key of ["studio_id", "location_id"]) {
    const v = search.get(key);
    if (v) keep.set(key, v);
  }

  useEffect(() => {
    startTransition(() => setPendingHref(null));
  }, [pathname]);

  return { pathname, keep, pendingHref, setPendingHref };
}

function navHref(href: string, keep: URLSearchParams) {
  return keep.toString() ? `${href}?${keep.toString()}` : href;
}

/* ── Desktop sidebar nav ─────────────────────────────────────────── */
export function DashboardNav({
  role,
  superAdminNoStudioMode = false,
}: {
  role: "owner" | "manager" | "frontdesk" | "instructor";
  superAdminNoStudioMode?: boolean;
}) {
  const visibleLinks = useVisibleLinks(role, superAdminNoStudioMode);
  const { pathname, keep, pendingHref, setPendingHref } = useNavState();
  const pkgApprovalsOverdueCount = usePkgApprovalsOverdueBadge();

  return (
    <nav className="flex flex-col gap-0.5">
      {visibleLinks.map((l) => {
        const active = isPayrollNavActive(pathname, l.href);
        const href = navHref(l.href, keep);
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
            {l.href === "/dashboard/packages" && pkgApprovalsOverdueCount > 0 ? (
              <span
                className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  active
                    ? "bg-white/95 text-teal-700"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                }`}
              >
                {pkgApprovalsOverdueCount > 99 ? "99+" : pkgApprovalsOverdueCount}
              </span>
            ) : null}
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
  role: "owner" | "manager" | "frontdesk" | "instructor";
  superAdminNoStudioMode?: boolean;
}) {
  const { primary, more } = splitMobileLinks(useVisibleLinks(role, superAdminNoStudioMode));
  const { pathname, keep, pendingHref, setPendingHref } = useNavState();
  const pkgApprovalsOverdueCount = usePkgApprovalsOverdueBadge();
  const [morePath, setMorePath] = useState<string | null>(null);
  const moreOpen = morePath === pathname;
  const moreActive = more.some((link) => isPayrollNavActive(pathname, link.href));

  useEffect(() => {
    if (moreOpen) {
      document.body.classList.add("menu-open");
    } else {
      document.body.classList.remove("menu-open");
    }
    return () => document.body.classList.remove("menu-open");
  }, [moreOpen]);

  const tabClass = (active: boolean, navigating: boolean) =>
    `relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[10px] font-medium transition-[color,opacity] duration-100 active:opacity-70 ${
      active
        ? "text-teal-600 dark:text-teal-400"
        : navigating
          ? "text-teal-500 dark:text-teal-500"
          : "text-stone-500 dark:text-stone-500"
    }`;

  return (
    <>
      {moreOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden dark:bg-black/40"
          onClick={() => setMorePath(null)}
        />
      ) : null}

      {more.length > 0 ? (
        <div
          className={`fixed inset-x-0 z-50 px-3 md:hidden ${
            moreOpen
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0"
          }`}
          style={{ bottom: "calc(3.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="max-h-[70dvh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-2 shadow-xl shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900">
            <nav className="flex flex-col gap-0.5" aria-label="More dashboard pages">
              {more.map((l) => {
                const active = isPayrollNavActive(pathname, l.href);
                const href = navHref(l.href, keep);
                const Icon = l.icon;
                return (
                  <Link
                    key={l.href}
                    href={href}
                    prefetch
                    onClick={() => {
                      setMorePath(null);
                      if (!active) setPendingHref(pathFromHref(l.href));
                    }}
                    className={`${ui.linkHeaderMenu} flex items-center gap-2.5 text-base`}
                  >
                    <Icon size={16} className="shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                    <span>{l.label}</span>
                    {l.href === "/dashboard/packages" && pkgApprovalsOverdueCount > 0 ? (
                      <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                        {pkgApprovalsOverdueCount > 99 ? "99+" : pkgApprovalsOverdueCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-stone-200/80 bg-white/90 backdrop-blur-xl md:hidden dark:border-stone-800/80 dark:bg-stone-950/90"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {primary.map((l) => {
          const active = isPayrollNavActive(pathname, l.href);
          const href = navHref(l.href, keep);
          const navigating = pendingHref === pathFromHref(l.href) && !active;
          const Icon = l.icon;

          return (
            <Link
              key={l.href}
              href={href}
              prefetch
              onClick={() => { if (active) return; setPendingHref(pathFromHref(l.href)); }}
              className={tabClass(active, navigating)}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.2 : 1.7}
                className={active ? "text-teal-600 dark:text-teal-400" : ""}
              />
              {l.href === "/dashboard/packages" && pkgApprovalsOverdueCount > 0 ? (
                <span className="absolute right-2 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                  {pkgApprovalsOverdueCount > 99 ? "99+" : pkgApprovalsOverdueCount}
                </span>
              ) : null}
              <span>{navigating ? "…" : l.label}</span>
            </Link>
          );
        })}
        {more.length > 0 ? (
          <button
            type="button"
            aria-label={moreOpen ? "Close more pages" : "More pages"}
            aria-expanded={moreOpen}
            onClick={() => setMorePath((current) => (current === pathname ? null : pathname))}
            className={tabClass(moreActive || moreOpen, false)}
          >
            <MoreHorizontal
              size={20}
              strokeWidth={moreActive || moreOpen ? 2.2 : 1.7}
              className={moreActive || moreOpen ? "text-teal-600 dark:text-teal-400" : ""}
            />
            <span>More</span>
          </button>
        ) : null}
      </nav>
    </>
  );
}

"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  CalendarRange,
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
  type LucideIcon,
} from "lucide-react";
import { usePkgApprovalsOverdueBadge } from "@/components/dashboard/pkg-approvals-overdue-badge";
import { isRouteActive, pathFromHref } from "@/lib/nav-active";

type NavLink = { href: string; label: string; icon: LucideIcon };

const links: NavLink[] = [
  { href: "/dashboard/operations", label: "Bookings", icon: LayoutDashboard },
  { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
  { href: "/dashboard/payments",   label: "Payments",   icon: CreditCard },
  { href: "/dashboard/pos",        label: "POS",        icon: ReceiptText },
  { href: "/dashboard/services",   label: "Services",   icon: BriefcaseBusiness },
  { href: "/dashboard/schedule",   label: "Sessions",   icon: Calendar },
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

function useVisibleLinks(
  role: "owner" | "manager" | "frontdesk" | "instructor",
  superAdminNoStudioMode: boolean,
) {
  const allowed = new Set(roleLinkAllowList[role]);
  return superAdminNoStudioMode
    ? links.filter((l) => l.href === "/dashboard/settings")
    : links.filter((l) => allowed.has(l.href));
}

function prioritizeMobileLinks(visibleLinks: NavLink[]) {
  const priority = new Map([
    ["/dashboard/operations", 0],
    ["/dashboard/appointments", 1],
    ["/dashboard/payments", 1],
    ["/dashboard/settings", 2],
    ["/dashboard/schedule", 3],
    ["/dashboard/clients", 4],
    ["/dashboard/packages", 4],
  ]);

  return [...visibleLinks].sort((a, b) => {
    const aPriority = priority.get(a.href) ?? 100;
    const bPriority = priority.get(b.href) ?? 100;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return visibleLinks.indexOf(a) - visibleLinks.indexOf(b);
  });
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
  for (const key of [
    "studio_id", "date_from", "date_to",
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
  const visibleLinks = prioritizeMobileLinks(useVisibleLinks(role, superAdminNoStudioMode));
  const { pathname, keep, pendingHref, setPendingHref } = useNavState();
  const pkgApprovalsOverdueCount = usePkgApprovalsOverdueBadge();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch overflow-x-auto overscroll-x-contain border-t border-stone-200/80 bg-white/90 backdrop-blur-xl [scrollbar-width:none] md:hidden dark:border-stone-800/80 dark:bg-stone-950/90 [&::-webkit-scrollbar]:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {visibleLinks.map((l) => {
        const active = isPayrollNavActive(pathname, l.href);
        const href = keep.toString() ? `${l.href}?${keep.toString()}` : l.href;
        const navigating = pendingHref === pathFromHref(l.href) && !active;
        const Icon = l.icon;

        return (
          <Link
            key={l.href}
            href={href}
            prefetch
            onClick={() => { if (active) return; setPendingHref(pathFromHref(l.href)); }}
            className={`relative flex min-w-[4.5rem] flex-none flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[10px] font-medium transition-[color,opacity] duration-100 active:opacity-70 ${
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
            {l.href === "/dashboard/packages" && pkgApprovalsOverdueCount > 0 ? (
              <span className="absolute right-2 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                {pkgApprovalsOverdueCount > 99 ? "99+" : pkgApprovalsOverdueCount}
              </span>
            ) : null}
            <span>{navigating ? "…" : l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

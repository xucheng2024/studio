"use client";

import Link from "next/link";
import { startTransition, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
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
  UserCog,
  ReceiptText,
  CreditCard,
  BarChart2,
  Mail,
  Settings,
  Wallet,
  MoreHorizontal,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { usePkgApprovalsOverdueBadge } from "@/components/dashboard/pkg-approvals-overdue-badge";
import { isRouteActive, pathFromHref } from "@/lib/nav-active";
import { ui } from "@/lib/ui";

type NavLink = { href: string; label: string; icon: LucideIcon };
type NavGroupId = "studio-page" | "manage";
type GroupOpenState = Record<NavGroupId, boolean>;

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
  { href: "/dashboard/staff",      label: "Staff",      icon: UserCog },
  { href: "/dashboard/marketing",  label: "Marketing",  icon: Mail },
  { href: "/dashboard/payroll",    label: "Payroll",    icon: Wallet },
  { href: "/dashboard/payroll/me", label: "My pay",     icon: Wallet },
  { href: "/dashboard/reports",    label: "Reports",    icon: BarChart2 },
  { href: "/dashboard/settings",   label: "Settings",   icon: Settings },
];

const roleLinkAllowList: Record<"owner" | "manager" | "frontdesk" | "instructor", string[]> = {
  owner:     links.map((l) => l.href).filter((href) => href !== "/dashboard/payroll/me"),
  manager:   links.map((l) => l.href).filter((href) => href !== "/dashboard/payroll" && href !== "/dashboard/payroll/me" && href !== "/dashboard/staff"),
  frontdesk: ["/dashboard/operations", "/dashboard/appointments", "/dashboard/payments", "/dashboard/pos", "/dashboard/schedule", "/dashboard/events", "/dashboard/packages", "/dashboard/memberships", "/dashboard/clients", "/dashboard/payroll/me"],
  instructor: ["/dashboard/appointments", "/dashboard/payroll/me"],
};

const MOBILE_PRIMARY_HREFS = [
  "/dashboard/operations",
  "/dashboard/appointments",
  "/dashboard/pos",
  "/dashboard/clients",
];

const STUDIO_PAGE_HREFS = [
  "/dashboard/services",
  "/dashboard/schedule",
  "/dashboard/events",
  "/dashboard/member-zone",
  "/dashboard/shop",
  "/dashboard/packages",
  "/dashboard/memberships",
];

const MANAGE_HREFS = [
  "/dashboard/clients",
  "/dashboard/staff",
  "/dashboard/marketing",
  "/dashboard/payroll",
  "/dashboard/payroll/me",
  "/dashboard/reports",
];

const SETTINGS_HREF = "/dashboard/settings";
const NAV_GROUPS_KEY = "studio:dashboard-nav:groups";
const DEFAULT_GROUP_OPEN: GroupOpenState = { "studio-page": false, manage: false };

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

function pickLinks(byHref: Map<string, NavLink>, hrefs: string[]) {
  return hrefs.map((href) => byHref.get(href)).filter((link): link is NavLink => Boolean(link));
}

function partitionNavLinks(items: NavLink[]) {
  const byHref = new Map(items.map((link) => [link.href, link]));
  const grouped = new Set([...STUDIO_PAGE_HREFS, ...MANAGE_HREFS, SETTINGS_HREF]);
  return {
    daily: items.filter((link) => !grouped.has(link.href)),
    studioPage: pickLinks(byHref, STUDIO_PAGE_HREFS),
    manage: pickLinks(byHref, MANAGE_HREFS),
    settings: byHref.get(SETTINGS_HREF) ?? null,
  };
}

function isPayrollNavActive(pathname: string, href: string) {
  if (href === "/dashboard/payroll" && (pathname === "/dashboard/payroll/me" || pathname.startsWith("/dashboard/payroll/me/"))) {
    return false;
  }
  return isRouteActive(pathname, href);
}

function groupHasActive(pathname: string, groupLinks: NavLink[]) {
  return groupLinks.some((link) => isPayrollNavActive(pathname, link.href));
}

function parseGroupOpen(raw: string | null): GroupOpenState {
  if (!raw) return { ...DEFAULT_GROUP_OPEN };
  try {
    const parsed = JSON.parse(raw) as Partial<GroupOpenState>;
    return {
      "studio-page": Boolean(parsed["studio-page"]),
      manage: Boolean(parsed.manage),
    };
  } catch {
    return { ...DEFAULT_GROUP_OPEN };
  }
}

const groupOpenListeners = new Set<() => void>();
let groupOpenMemory: GroupOpenState | null = null;

function subscribeGroupOpen(onChange: () => void) {
  groupOpenListeners.add(onChange);
  return () => {
    groupOpenListeners.delete(onChange);
  };
}

function getGroupOpenSnapshot(): GroupOpenState {
  if (groupOpenMemory) return groupOpenMemory;
  try {
    groupOpenMemory = parseGroupOpen(window.localStorage.getItem(NAV_GROUPS_KEY));
  } catch {
    groupOpenMemory = { ...DEFAULT_GROUP_OPEN };
  }
  return groupOpenMemory;
}

function writeGroupOpen(next: GroupOpenState) {
  groupOpenMemory = next;
  try {
    window.localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  groupOpenListeners.forEach((listener) => listener());
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

function sidebarLinkClass(active: boolean, navigating: boolean) {
  return `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-[color,background-color,opacity] duration-100 active:scale-[0.98] active:opacity-90 ${
    active
      ? "bg-teal-600 text-white shadow-sm shadow-teal-600/30"
      : navigating
        ? "bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-100"
        : "text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
  }`;
}

function SidebarNavLink({
  link,
  pathname,
  keep,
  pendingHref,
  setPendingHref,
  pkgApprovalsOverdueCount,
}: {
  link: NavLink;
  pathname: string;
  keep: URLSearchParams;
  pendingHref: string | null;
  setPendingHref: (href: string | null) => void;
  pkgApprovalsOverdueCount: number;
}) {
  const active = isPayrollNavActive(pathname, link.href);
  const href = navHref(link.href, keep);
  const navigating = pendingHref === pathFromHref(link.href) && !active;
  const Icon = link.icon;

  return (
    <Link
      href={href}
      prefetch
      onClick={() => { if (active) return; setPendingHref(pathFromHref(link.href)); }}
      className={sidebarLinkClass(active, navigating)}
    >
      <Icon size={15} className="shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span>{navigating ? `${link.label}…` : link.label}</span>
      {link.href === "/dashboard/packages" && pkgApprovalsOverdueCount > 0 ? (
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
}

function NavGroupLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
      {label}
    </div>
  );
}

function CollapsibleNavGroup({
  id,
  label,
  open,
  onToggle,
  collapsedBadge,
  children,
}: {
  id: NavGroupId;
  label: string;
  open: boolean;
  onToggle: (id: NavGroupId) => void;
  collapsedBadge?: number;
  children: ReactNode;
}) {
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(id)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-400 transition hover:bg-stone-200/50 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800/80 dark:hover:text-stone-300"
      >
        <span className="flex-1">{label}</span>
        {!open && collapsedBadge && collapsedBadge > 0 ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
            {collapsedBadge > 99 ? "99+" : collapsedBadge}
          </span>
        ) : null}
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open ? <div className="flex flex-col gap-0.5">{children}</div> : null}
    </div>
  );
}

function useGroupOpen(pathname: string, studioPage: NavLink[], manage: NavLink[]) {
  const openGroups = useSyncExternalStore(
    subscribeGroupOpen,
    getGroupOpenSnapshot,
    () => DEFAULT_GROUP_OPEN,
  );
  const studioActive = groupHasActive(pathname, studioPage);
  const manageActive = groupHasActive(pathname, manage);

  const toggle = (id: NavGroupId) => {
    const forcedOpen = id === "studio-page" ? studioActive : manageActive;
    if (forcedOpen) return;
    writeGroupOpen({ ...openGroups, [id]: !openGroups[id] });
  };

  return {
    studioPageOpen: studioActive || openGroups["studio-page"],
    manageOpen: manageActive || openGroups.manage,
    toggle,
  };
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
  const { daily, studioPage, manage, settings } = partitionNavLinks(visibleLinks);
  const { pathname, keep, pendingHref, setPendingHref } = useNavState();
  const pkgApprovalsOverdueCount = usePkgApprovalsOverdueBadge();
  const { studioPageOpen, manageOpen, toggle } = useGroupOpen(pathname, studioPage, manage);

  const linkProps = { pathname, keep, pendingHref, setPendingHref, pkgApprovalsOverdueCount };

  return (
    <nav className="flex flex-col gap-0.5">
      {daily.length > 0 ? (
        <div>
          <NavGroupLabel label="Daily" />
          <div className="flex flex-col gap-0.5">
            {daily.map((link) => (
              <SidebarNavLink key={link.href} link={link} {...linkProps} />
            ))}
          </div>
        </div>
      ) : null}

      {studioPage.length > 0 ? (
        <CollapsibleNavGroup
          id="studio-page"
          label="Studio"
          open={studioPageOpen}
          onToggle={toggle}
          collapsedBadge={
            studioPage.some((link) => link.href === "/dashboard/packages")
              ? pkgApprovalsOverdueCount
              : undefined
          }
        >
          {studioPage.map((link) => (
            <SidebarNavLink key={link.href} link={link} {...linkProps} />
          ))}
        </CollapsibleNavGroup>
      ) : null}

      {manage.length > 0 ? (
        <CollapsibleNavGroup
          id="manage"
          label="Manage"
          open={manageOpen}
          onToggle={toggle}
        >
          {manage.map((link) => (
            <SidebarNavLink key={link.href} link={link} {...linkProps} />
          ))}
        </CollapsibleNavGroup>
      ) : null}

      {settings ? (
        <div className={daily.length || studioPage.length || manage.length ? "mt-1" : undefined}>
          <SidebarNavLink link={settings} {...linkProps} />
        </div>
      ) : null}
    </nav>
  );
}

function MoreSheetLink({
  link,
  pathname,
  keep,
  pkgApprovalsOverdueCount,
  onNavigate,
}: {
  link: NavLink;
  pathname: string;
  keep: URLSearchParams;
  pkgApprovalsOverdueCount: number;
  onNavigate: (active: boolean, href: string) => void;
}) {
  const active = isPayrollNavActive(pathname, link.href);
  const href = navHref(link.href, keep);
  const Icon = link.icon;
  return (
    <Link
      href={href}
      prefetch
      onClick={() => onNavigate(active, pathFromHref(link.href))}
      className={`${ui.linkHeaderMenu} flex items-center gap-2.5 text-base`}
    >
      <Icon size={16} className="shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span>{link.label}</span>
      {link.href === "/dashboard/packages" && pkgApprovalsOverdueCount > 0 ? (
        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
          {pkgApprovalsOverdueCount > 99 ? "99+" : pkgApprovalsOverdueCount}
        </span>
      ) : null}
    </Link>
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
  const { daily, studioPage, manage, settings } = partitionNavLinks(more);
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

  const onMoreNavigate = (active: boolean, href: string) => {
    setMorePath(null);
    if (!active) setPendingHref(href);
  };

  const moreLinkProps = { pathname, keep, pkgApprovalsOverdueCount, onNavigate: onMoreNavigate };

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
              {daily.length > 0 ? (
                <>
                  <NavGroupLabel label="Daily" />
                  {daily.map((link) => (
                    <MoreSheetLink key={link.href} link={link} {...moreLinkProps} />
                  ))}
                </>
              ) : null}
              {studioPage.length > 0 ? (
                <>
                  <NavGroupLabel label="Studio" />
                  {studioPage.map((link) => (
                    <MoreSheetLink key={link.href} link={link} {...moreLinkProps} />
                  ))}
                </>
              ) : null}
              {manage.length > 0 ? (
                <>
                  <NavGroupLabel label="Manage" />
                  {manage.map((link) => (
                    <MoreSheetLink key={link.href} link={link} {...moreLinkProps} />
                  ))}
                </>
              ) : null}
              {settings ? <MoreSheetLink link={settings} {...moreLinkProps} /> : null}
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

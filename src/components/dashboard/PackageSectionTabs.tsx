"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { usePkgApprovalsOverdueBadge } from "@/components/dashboard/pkg-approvals-overdue-badge";

const CATALOG_HREF = "/dashboard/packages";
const APPROVALS_HREF = "/dashboard/packages/approvals";

function scopedHref(path: string, studioId: string | null, locationId: string | null) {
  const params = new URLSearchParams();
  if (studioId) params.set("studio_id", studioId);
  if (locationId) params.set("location_id", locationId);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function PackageSectionTabs() {
  const pathname = usePathname();
  const search = useSearchParams();
  const overdueCount = usePkgApprovalsOverdueBadge();
  const studioId = search.get("studio_id");
  const locationId = search.get("location_id");
  const catalogActive = pathname === CATALOG_HREF;
  const approvalsActive = pathname === APPROVALS_HREF || pathname.startsWith(`${APPROVALS_HREF}/`);

  const tabs = [
    { href: scopedHref(CATALOG_HREF, studioId, locationId), label: "Catalog", active: catalogActive },
    { href: scopedHref(APPROVALS_HREF, studioId, locationId), label: "Approvals", active: approvalsActive, badge: overdueCount },
  ];

  return (
    <nav
      aria-label="Packages sections"
      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1 dark:bg-stone-800/80"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            tab.active
              ? "bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-100"
              : "text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
          }`}
        >
          {tab.label}
          {tab.badge && tab.badge > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              {tab.badge > 99 ? "99+" : tab.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

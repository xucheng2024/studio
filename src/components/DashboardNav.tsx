"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isRouteActive, pathFromHref } from "@/lib/nav-active";

const links = [
  { href: "/dashboard/operations", label: "Operations" },
  { href: "/dashboard/schedule", label: "Schedule" },
  { href: "/dashboard/clients", label: "Members" },
  { href: "/dashboard/reports", label: "Reports" },
  { href: "/dashboard/settings", label: "Settings" },
];

const roleLinkAllowList: Record<"owner" | "manager" | "frontdesk", string[]> = {
  owner: links.map((l) => l.href),
  manager: [
    "/dashboard/operations",
    "/dashboard/schedule",
    "/dashboard/clients",
    "/dashboard/reports",
    "/dashboard/settings",
  ],
  frontdesk: [
    "/dashboard/operations",
    "/dashboard/schedule",
    "/dashboard/clients",
  ],
};

export function DashboardNav({
  role,
  superAdminNoStudioMode = false,
}: {
  role: "owner" | "manager" | "frontdesk";
  superAdminNoStudioMode?: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const keep = new URLSearchParams();
  for (const key of ["studio_id", "location_id", "date_from", "date_to", "status", "recon_status", "q"]) {
    const v = search.get(key);
    if (v) keep.set(key, v);
  }
  const allowed = new Set(roleLinkAllowList[role]);
  const visibleLinks = superAdminNoStudioMode
    ? links.filter((l) => l.href === "/dashboard/settings")
    : links.filter((l) => allowed.has(l.href));

  useEffect(() => {
    startTransition(() => setPendingHref(null));
  }, [pathname]);

  return (
    <nav className="flex flex-col gap-1">
      {visibleLinks.map((l) => {
        const active = isRouteActive(pathname, l.href);
        const href = keep.toString() ? `${l.href}?${keep.toString()}` : l.href;
        const navigatingHere = pendingHref === pathFromHref(l.href) && !active;
        return (
          <Link
            key={l.href}
            href={href}
            prefetch
            onClick={() => {
              if (active) return;
              setPendingHref(pathFromHref(l.href));
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-[color,background-color,transform,opacity] duration-100 active:scale-[0.98] active:opacity-90 ${
              active
                ? "bg-teal-600 text-white shadow-sm dark:bg-teal-600"
                : navigatingHere
                  ? "bg-teal-100 text-teal-900 ring-2 ring-teal-500/40 dark:bg-teal-950/80 dark:text-teal-100 dark:ring-teal-500/30"
                  : "text-stone-600 hover:bg-stone-200/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            }`}
          >
            {navigatingHere ? `${l.label}…` : l.label}
          </Link>
        );
      })}
    </nav>
  );
}

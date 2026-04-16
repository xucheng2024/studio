"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

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
}: {
  role: "owner" | "manager" | "frontdesk";
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const keep = new URLSearchParams();
  for (const key of ["studio_id", "location_id", "date_from", "date_to", "status", "recon_status", "q"]) {
    const v = search.get(key);
    if (v) keep.set(key, v);
  }
  const allowed = new Set(roleLinkAllowList[role]);
  const visibleLinks = links.filter((l) => allowed.has(l.href));

  return (
    <nav className="flex flex-col gap-1">
      {visibleLinks.map((l) => {
        const active =
          pathname === l.href || pathname.startsWith(`${l.href}/`);
        const href = keep.toString() ? `${l.href}?${keep.toString()}` : l.href;
        return (
          <Link
            key={l.href}
            href={href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-teal-600 text-white shadow-sm dark:bg-teal-600"
                : "text-stone-600 hover:bg-stone-200/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

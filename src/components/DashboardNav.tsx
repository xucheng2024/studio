"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/qr", label: "QR code" },
  { href: "/dashboard/classes", label: "Classes" },
  { href: "/dashboard/schedule", label: "Schedule" },
  { href: "/dashboard/clients", label: "Members" },
  { href: "/dashboard/packages", label: "Packages" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/frontdesk", label: "Frontdesk" },
  { href: "/dashboard/reports", label: "Reports" },
  { href: "/dashboard/staff", label: "Staff" },
  { href: "/dashboard/settings/payments", label: "Payment settings" },
];

export function DashboardNav() {
  const pathname = usePathname();
  const search = useSearchParams();
  const locationId = search.get("location_id");

  return (
    <nav className="flex flex-col gap-1">
      {links.map((l) => {
        const active =
          l.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={locationId ? `${l.href}?location_id=${locationId}` : l.href}
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

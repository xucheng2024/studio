"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { studioMePath } from "@/lib/public-paths";

const tabs = [
  { key: "bookings", label: "Bookings", section: "bookings" },
  { key: "class-passes", label: "Passes", section: "class-passes" },
  { key: "orders", label: "Orders", section: "orders" },
  { key: "memberships", label: "Memberships", section: "memberships" },
  { key: "profile", label: "Profile", section: "profile" },
];

export function StudioMemberTabs({ studioSlug }: { studioSlug: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Member navigation"
      className="sticky top-0 z-20 -mx-4 border-b border-stone-200/80 bg-white/92 px-4 py-3 backdrop-blur dark:border-stone-800 dark:bg-stone-950/88 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="mx-auto flex max-w-2xl gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const href = studioMePath(studioSlug, tab.section);
          const isActive = pathname === href;
          return (
            <Link
              key={tab.key}
              href={href}
              className={`inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-sm font-medium transition ${
                isActive
                  ? "bg-teal-600 text-white shadow-sm"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

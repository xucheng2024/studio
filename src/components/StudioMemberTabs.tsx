"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { studioHomePath, studioMePath } from "@/lib/public-paths";

const tabs = [
  { key: "appointments", label: "Appointments", section: "appointments" },
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
        <Link
          href={studioHomePath(studioSlug)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-stone-500 underline-offset-4 transition hover:bg-stone-100 hover:text-stone-900 hover:underline dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
        >
          <ArrowLeft size={14} aria-hidden className="shrink-0 opacity-80" />
          Back to studio
        </Link>
        <span className="my-auto h-4 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
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

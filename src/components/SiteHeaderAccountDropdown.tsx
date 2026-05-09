"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SignOutButton } from "@/components/SignOutButton";
import { ui } from "@/lib/ui";

type NavItem = { href: string; label: string };

export function SiteHeaderAccountDropdown({
  userInitial,
  navItems,
}: {
  userInitial: string;
  navItems: NavItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative ml-1" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-stone-100 dark:hover:bg-stone-800"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-100">
          {userInitial}
        </span>
        <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
          Account
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 min-w-44 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={ui.linkHeaderMenu} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <div className={`mt-1 border-t ${ui.divider} pt-1`}>
            <SignOutButton />
          </div>
        </div>
      ) : null}
    </div>
  );
}

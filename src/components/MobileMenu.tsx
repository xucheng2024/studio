"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { SignOutButton } from "@/components/SignOutButton";
import { ui } from "@/lib/ui";

type NavItem = { href: string; label: string };

export function MobileMenu({
  navItems,
  isLoggedIn,
}: {
  navItems: NavItem[];
  isLoggedIn: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.classList.add("menu-open");
    } else {
      document.body.classList.remove("menu-open");
    }
    return () => document.body.classList.remove("menu-open");
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-lg text-stone-600 transition hover:bg-stone-100 active:opacity-70 dark:text-stone-400 dark:hover:bg-stone-800"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm dark:bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer panel */}
      <div
        className={`fixed inset-x-0 top-14 z-50 transition-[transform,opacity] duration-200 ${
          open
            ? "translate-y-0 opacity-100"
            : "-translate-y-2 pointer-events-none opacity-0"
        }`}
      >
        <div className="mx-3 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900">
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${ui.linkHeaderMenu} text-base`}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {isLoggedIn && (
            <>
              <div className={`my-1.5 ${ui.divider}`} />
              <SignOutButton />
            </>
          )}
          {!isLoggedIn && (
            <>
              <div className={`my-1.5 ${ui.divider}`} />
              <Link
                href="/auth"
                className={`${ui.btnPrimary} w-full`}
                onClick={() => setOpen(false)}
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

type TabItem = {
  href: string;
  label: string;
};

export function StudioSectionTabs({ items }: { items: TabItem[] }) {
  const [activeHref, setActiveHref] = useState<string>(items[0]?.href ?? "");

  const sectionIds = useMemo(
    () => items.map((item) => item.href.replace(/^#/, "")).filter(Boolean),
    [items],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const resolveActive = () => {
      const threshold = 100;
      let current = sectionIds[0] ?? "";
      for (const id of sectionIds) {
        const element = document.getElementById(id);
        if (!element) continue;
        if (element.getBoundingClientRect().top - threshold <= 0) current = id;
      }
      if (current) setActiveHref(`#${current}`);
    };

    resolveActive();
    window.addEventListener("scroll", resolveActive, { passive: true });
    window.addEventListener("resize", resolveActive);
    return () => {
      window.removeEventListener("scroll", resolveActive);
      window.removeEventListener("resize", resolveActive);
    };
  }, [sectionIds]);

  return (
    <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-white/85 backdrop-blur-md dark:bg-stone-950/85" />

      {/* mobile: wrapping two-row grid; sm+: single scrollable row */}
      <div className="relative px-4 py-2.5 sm:px-6 lg:px-8">

        {/* mobile two-row flex-wrap */}
        <div className="flex flex-wrap gap-1.5 sm:hidden">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <a
                key={item.href}
                href={item.href}
                className={[
                  "inline-flex items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100",
                ].join(" ")}
                onClick={() => setActiveHref(item.href)}
              >
                {item.label}
              </a>
            );
          })}
        </div>

        {/* sm+: single scrollable row */}
        <div
          className="hidden sm:flex gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <a
                key={item.href}
                href={item.href}
                className={[
                  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                ].join(" ")}
                onClick={() => setActiveHref(item.href)}
              >
                {item.label}
              </a>
            );
          })}
        </div>
      </div>

      {/* bottom divider */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-stone-100 dark:bg-stone-800" />
    </div>
  );
}

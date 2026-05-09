"use client";

import { useEffect, useRef, useState } from "react";

export type StickyNavTab = { id: string; label: string };

export function StudioStickyNav({ tabs }: { tabs: StickyNavTab[] }) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? "");
  const navRef = useRef<HTMLElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (tabs.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-72px 0px -55% 0px", threshold: 0 },
    );

    for (const tab of tabs) {
      const el = document.getElementById(tab.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [tabs]);

  // Scroll the active pill into view inside the nav bar
  useEffect(() => {
    const btn = buttonRefs.current[activeId];
    btn?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const navHeight = navRef.current?.offsetHeight ?? 52;
    const top = el.getBoundingClientRect().top + window.scrollY - navHeight - 8;
    window.scrollTo({ top, behavior: "smooth" });
    setActiveId(id);
  };

  if (tabs.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-30 -mx-4 border-b border-stone-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/90 sm:-mx-6 lg:-mx-8"
    >
      <div className="flex gap-0.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => { buttonRefs.current[tab.id] = el; }}
            type="button"
            onClick={() => scrollTo(tab.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              activeId === tab.id
                ? "bg-teal-600 text-white shadow-sm"
                : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

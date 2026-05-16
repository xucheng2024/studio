"use client";

import { useEffect, useRef, useState } from "react";
import { StudioAccountEntry } from "@/components/StudioAccountEntry";

export type StickyNavTab = { id: string; label: string };

type UpdateMap = Partial<Record<"services" | "classes" | "events" | "packages" | "member-zone" | "shop", string>>;

function seenStorageKey(studioSlug: string, sectionId: string) {
  return `studio:pwa:seen:${studioSlug}:${sectionId}`;
}

export function StudioStickyNav({
  tabs,
  studioSlug,
  studioName,
  logoUrl,
  studioBadgeLabel,
  showMembershipsLink,
  introSectionId,
}: {
  tabs: StickyNavTab[];
  studioSlug?: string;
  studioName?: string;
  logoUrl?: string | null;
  studioBadgeLabel?: string;
  showMembershipsLink?: boolean;
  /** When set, clicking the left brand cluster scrolls to this section id */
  introSectionId?: string;
}) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? "");
  const [updates, setUpdates] = useState<UpdateMap>({});
  const [seenAt, setSeenAt] = useState<Record<string, number>>({});
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

  useEffect(() => {
    if (!studioSlug) return;
    const controller = new AbortController();
    void fetch(`/api/pwa/updates?studioSlug=${encodeURIComponent(studioSlug)}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        setUpdates((json?.updates ?? {}) as UpdateMap);
      })
      .catch(() => null);
    return () => controller.abort();
  }, [studioSlug]);

  useEffect(() => {
    if (!studioSlug) return;
    const next: Record<string, number> = {};
    for (const tab of tabs) {
      const raw = localStorage.getItem(seenStorageKey(studioSlug, tab.id));
      next[tab.id] = raw ? Number(raw) || 0 : 0;
    }
    setSeenAt(next);
  }, [studioSlug, tabs]);

  // Scroll the active pill into view inside the nav bar
  useEffect(() => {
    const btn = buttonRefs.current[activeId];
    btn?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [activeId]);

  useEffect(() => {
    if (!studioSlug || !activeId) return;
    const now = Date.now();
    localStorage.setItem(seenStorageKey(studioSlug, activeId), String(now));
    setSeenAt((prev) => ({ ...prev, [activeId]: now }));
  }, [activeId, studioSlug]);

  const sectionUpdatedAt: Record<string, number> = {
    services: updates.services ? new Date(updates.services).getTime() : 0,
    classes: updates.classes ? new Date(updates.classes).getTime() : 0,
    "upcoming-classes": updates.classes ? new Date(updates.classes).getTime() : 0,
    events: updates.events ? new Date(updates.events).getTime() : 0,
    packages: updates.packages ? new Date(updates.packages).getTime() : 0,
    "member-zone": updates["member-zone"] ? new Date(updates["member-zone"]).getTime() : 0,
    shop: updates.shop ? new Date(updates.shop).getTime() : 0,
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const navHeight = navRef.current?.offsetHeight ?? 52;
    const top = el.getBoundingClientRect().top + window.scrollY - navHeight - 8;
    window.scrollTo({ top, behavior: "smooth" });
    setActiveId(id);
  };

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-30 -mx-4 border-b border-stone-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/90 sm:-mx-6 lg:-mx-8"
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-1.5">
        {/* Left: studio identity */}
        {studioName ? (
          introSectionId ? (
            <button
              type="button"
              onClick={() => scrollTo(introSectionId)}
              className="flex min-w-0 shrink-0 items-center gap-2 rounded-md pr-1 text-left outline-none ring-teal-600/40 transition hover:bg-stone-100/80 focus-visible:ring-2 dark:hover:bg-stone-800/60"
              aria-label="Back to intro"
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt=""
                  className="size-9 shrink-0 rounded-md object-contain object-center"
                  loading="eager"
                />
              ) : (
                <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-teal-100 text-sm font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-100">
                  {studioBadgeLabel ?? studioName[0]?.toUpperCase()}
                </div>
              )}
              {/* Hide name on mobile to give pills more room */}
              <span className="hidden max-w-[160px] truncate text-sm font-semibold text-stone-900 dark:text-stone-100 sm:inline">
                {studioName}
              </span>
            </button>
          ) : (
            <div className="flex shrink-0 items-center gap-2 pr-1">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={studioName}
                  className="size-9 shrink-0 rounded-md object-contain object-center"
                  loading="eager"
                />
              ) : (
                <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-teal-100 text-sm font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-100">
                  {studioBadgeLabel ?? studioName[0]?.toUpperCase()}
                </div>
              )}
              <span className="hidden max-w-[160px] truncate text-sm font-semibold text-stone-900 dark:text-stone-100 sm:inline">
                {studioName}
              </span>
            </div>
          )
        ) : (
          <div />
        )}

        {/* Center: section pills */}
        {tabs.length > 0 ? (
          <div className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                <span className="inline-flex items-center gap-1.5">
                  <span>{tab.label}</span>
                  {sectionUpdatedAt[tab.id] > (seenAt[tab.id] ?? 0) ? (
                    <span className="inline-flex h-2 w-2 rounded-full bg-red-500" aria-label="new updates" />
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}

        {/* Right: account entry */}
        {studioSlug ? (
          <div className="shrink-0 pl-1">
            <StudioAccountEntry studioSlug={studioSlug} showMembershipsLink={showMembershipsLink} />
          </div>
        ) : (
          <div />
        )}
      </div>
    </nav>
  );
}

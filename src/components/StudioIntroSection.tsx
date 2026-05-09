"use client";

import { useEffect, useState } from "react";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { createBrowserSupabase } from "@/lib/supabase/client";

type Props = {
  studioName: string;
  studioMediaCover: string | null;
  embedUrl: string | null;
  videoUrl: string | null;
  intro: string | null;
};

const LS_KEY = "studio:loggedIn";

export function StudioIntroSection({ studioName, studioMediaCover, embedUrl, videoUrl, intro }: Props) {
  // Seed from localStorage so we don't flash on cached PWA opens
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    const cached = localStorage.getItem(LS_KEY);
    return cached === null ? null : cached === "1";
  });

  useEffect(() => {
    const supabase = createBrowserSupabase();
    supabase.auth.getSession().then(({ data }) => {
      const loggedIn = Boolean(data.session?.user);
      setIsLoggedIn(loggedIn);
      localStorage.setItem(LS_KEY, loggedIn ? "1" : "0");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const loggedIn = Boolean(session?.user);
      setIsLoggedIn(loggedIn);
      localStorage.setItem(LS_KEY, loggedIn ? "1" : "0");
    });
    return () => subscription.unsubscribe();
  }, []);

  // Still checking on very first ever visit → show intro (safer default)
  if (isLoggedIn === true) return null;

  return (
    <div className="pb-4">
      <div className="grid gap-5 sm:grid-cols-[minmax(260px,44%)_minmax(0,1fr)] sm:items-start">
        <div className="w-full">
          <PublicVideoCover
            title={studioName}
            coverUrl={studioMediaCover}
            embedUrl={embedUrl}
            fallbackUrl={videoUrl}
            priority
          />
        </div>
        <div className="sm:pt-1">
          {intro?.trim() ? (
            <details className="group">
              <summary className="cursor-pointer list-none text-sm leading-snug text-stone-700 dark:text-stone-300">
                <span className="line-clamp-3 whitespace-pre-wrap">{intro.trim()}</span>
                <span className="mt-2 inline-flex text-sm font-semibold text-teal-700 group-open:hidden dark:text-teal-400">
                  Read more
                </span>
                <span className="mt-2 hidden text-sm font-semibold text-teal-700 group-open:inline-flex dark:text-teal-400">
                  Show less
                </span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-snug text-stone-700 dark:text-stone-300">
                {intro.trim()}
              </p>
            </details>
          ) : (
            <p className="text-sm leading-snug text-stone-700 dark:text-stone-300">
              Welcome to our studio. Explore services and get in touch.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

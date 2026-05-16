"use client";

import { PublicVideoCover } from "@/components/PublicVideoCover";

type Props = {
  studioName: string;
  studioMediaCover: string | null;
  embedUrl: string | null;
  videoUrl: string | null;
  intro: string | null;
};

export function StudioIntroSection({ studioName, studioMediaCover, embedUrl, videoUrl, intro }: Props) {
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

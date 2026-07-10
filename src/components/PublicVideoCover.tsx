'use client'

import Image from "next/image";
import { PlayCircle } from "lucide-react";
import { useState } from "react";
import { CoverLocationCornerBadge } from "@/components/SessionDateMiniCalendar";

type PublicVideoCoverProps = {
  title: string;
  coverUrl: string | null;
  embedUrl: string | null;
  fallbackUrl: string | null;
  priority?: boolean;
  locationLabel?: string | null;
};

export function PublicVideoCover({
  title,
  coverUrl,
  embedUrl,
  fallbackUrl,
  priority = false,
  locationLabel,
}: PublicVideoCoverProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const cleanEmbedUrl = getCleanEmbedUrl(embedUrl);

  if (isPlaying && cleanEmbedUrl) {
    return (
      <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm dark:border-stone-700">
        <iframe
          src={cleanEmbedUrl}
          title={`${title} promo video`}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  const media = coverUrl ? (
    <div className="relative aspect-video w-full">
      <Image
        src={coverUrl}
        alt={`${title} cover`}
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, 720px"
        priority={priority}
        loading={priority ? "eager" : "lazy"}
      />
    </div>
  ) : (
    <div className="aspect-video w-full bg-stone-100 dark:bg-stone-900" />
  );

  if (!embedUrl && fallbackUrl) {
    return (
      <a
        href={fallbackUrl}
        target="_blank"
        rel="noreferrer"
        className="group block overflow-hidden rounded-2xl border border-stone-200 shadow-sm transition hover:shadow-md dark:border-stone-700"
        aria-label={`Watch ${title} video`}
      >
        <div className="relative">
          {media}
          <span className="absolute inset-0 z-0 flex items-center justify-center bg-black/20 transition group-hover:bg-black/28">
            <span className="inline-flex items-center justify-center rounded-full bg-black/68 p-3 text-white backdrop-blur-sm">
              <PlayCircle size={22} />
            </span>
          </span>
          <CoverLocationCornerBadge name={locationLabel} />
        </div>
      </a>
    );
  }

  if (embedUrl) {
    return (
      <button
        type="button"
        onClick={() => setIsPlaying(true)}
        className="group block w-full overflow-hidden rounded-2xl border border-stone-200 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 dark:border-stone-700"
        aria-label={`Play ${title} video`}
      >
        <div className="relative">
          {media}
          <span className="absolute inset-0 z-0 flex items-center justify-center bg-black/20 transition group-hover:bg-black/28">
            <span className="inline-flex items-center justify-center rounded-full bg-black/68 p-3 text-white backdrop-blur-sm">
              <PlayCircle size={22} />
            </span>
          </span>
          <CoverLocationCornerBadge name={locationLabel} />
        </div>
      </button>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-stone-200 shadow-sm dark:border-stone-700">
      {media}
      <CoverLocationCornerBadge name={locationLabel} />
    </div>
  );
}

function getCleanEmbedUrl(embedUrl: string | null) {
  if (!embedUrl) return null;
  try {
    const url = new URL(embedUrl);
    if (url.hostname.replace(/^www\./, "").toLowerCase() === "player.mux.com") {
      url.searchParams.set("disable-remote-playback", "true");
      if (typeof window !== "undefined") {
        url.searchParams.set("storyboard-src", `${window.location.origin}/api/video/empty-storyboard.vtt`);
      }
    }
    return url.toString();
  } catch {
    return embedUrl;
  }
}

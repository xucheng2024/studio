"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";

type Props = {
  mainImage: string | null;
  extraImages: string[];
  alt: string;
  priority?: boolean;
  sharePath?: string;
  shareTitle?: string;
  shareText?: string;
};

export function ShopImageGallery({ mainImage, extraImages, alt, priority = false, sharePath, shareTitle, shareText }: Props) {
  const allImages = [mainImage, ...extraImages].filter((u): u is string => !!u);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive((prev) => Math.min(prev, Math.max(0, allImages.length - 1)));
  }, [allImages.length]);

  if (!allImages.length) {
    return <div className="aspect-square w-full rounded-2xl bg-stone-100 dark:bg-stone-900" />;
  }
  const safeActive = Math.min(active, allImages.length - 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800">
        <Image
          src={allImages[safeActive]}
          alt={alt}
          width={1200}
          height={1200}
          sizes="(max-width: 1024px) 100vw, 600px"
          priority={priority}
          className="h-full w-full object-cover transition-opacity duration-200"
        />
        {sharePath && (
          <div className="absolute bottom-3 right-3 z-20">
            <SessionShareLinkButton
              sharePath={sharePath}
              title={shareTitle ?? alt}
              text={shareText}
            />
          </div>
        )}
      </div>
      {allImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {allImages.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActive(idx)}
              className={`shrink-0 size-16 overflow-hidden rounded-xl border-2 transition ${
                idx === safeActive
                  ? "border-teal-500 opacity-100"
                  : "border-stone-200 opacity-60 hover:opacity-90 dark:border-stone-700"
              }`}
            >
              <Image
                src={url}
                alt=""
                width={64}
                height={64}
                className="h-full w-full object-cover"
                sizes="64px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

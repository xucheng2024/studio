"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { PublicMediaUploader } from "@/components/dashboard/PublicMediaUploader";
import { ui } from "@/lib/ui";

const MAX_EXTRA = 5;

type Props = {
  studioId: string;
  entityId: string;
  defaultValues: string[];
};

export function ShopExtraImagesField({ studioId, entityId, defaultValues }: Props) {
  const [urls, setUrls] = useState<string[]>(defaultValues);

  useEffect(() => {
    setUrls(defaultValues);
  }, [entityId, defaultValues]);

  const add = (url: string) => setUrls((prev) => (prev.length >= MAX_EXTRA ? prev : [...prev, url]));
  const remove = (idx: number) => setUrls((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={ui.label}>Extra images</span>
        <span className={ui.muted}>{urls.length} / {MAX_EXTRA}</span>
      </div>
      <input type="hidden" name="image_urls" value={JSON.stringify(urls)} />
      <div className="flex flex-wrap gap-2">
        {urls.map((url, idx) => (
          <div
            key={idx}
            className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700"
          >
            <Image src={url} alt="" fill className="object-cover" sizes="80px" />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {urls.length < MAX_EXTRA && (
          <PublicMediaUploader
            studioId={studioId}
            folder="shop"
            entityId={`${entityId}-extra`}
            label="Add"
            onUploaded={add}
          />
        )}
      </div>
      {urls.length === 0 && (
        <p className={ui.muted}>Upload up to {MAX_EXTRA} extra images shown in the product gallery.</p>
      )}
    </div>
  );
}

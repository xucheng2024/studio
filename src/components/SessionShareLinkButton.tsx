"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  /** Path starting with `/` (e.g. `/class/...?session_id=`) */
  sharePath: string;
  title: string;
  text?: string;
};

function toAbsoluteUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return normalized;
  return new URL(normalized, window.location.origin).href;
}


export function SessionShareLinkButton({ sharePath, title, text }: Props) {
  return (
    <button
      type="button"
      aria-label="Share link"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = toAbsoluteUrl(sharePath);
        const body = text?.trim() ?? "";
        if (navigator.share) {
          try {
            await navigator.share({ title, text: body || undefined, url });
            return;
          } catch {
            // user cancelled or share failed; continue to fallback copy only when needed
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          toast.success("Link copied");
        } catch {
          toast.error("Could not share link");
        }
      }}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-black/65 text-white shadow-lg shadow-black/20 transition hover:bg-black/75 active:scale-[0.95] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <Share2 size={18} />
    </button>
  );
}

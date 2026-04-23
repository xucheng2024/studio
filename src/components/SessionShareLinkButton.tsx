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

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function SessionShareLinkButton({ sharePath, title, text }: Props) {
  return (
    <button
      type="button"
      aria-label="Share this session link"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = toAbsoluteUrl(sharePath);
        const body = text?.trim() ?? "";

        void (async () => {
          if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            try {
              await navigator.share({ title, text: body, url });
              return;
            } catch (err: unknown) {
              const name =
                err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
              if (name === "AbortError") return;
            }
          }
          const ok = await copyToClipboard(url);
          if (ok) toast.success("Session link copied — paste to share.");
          else toast.error("Could not copy link.");
        })();
      }}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/35 bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-[0.97]"
    >
      <Share2 className="size-4" strokeWidth={2} aria-hidden />
    </button>
  );
}

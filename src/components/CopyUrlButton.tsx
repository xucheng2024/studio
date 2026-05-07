"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ui } from "@/lib/ui";

export function CopyUrlButton({ url, className, label }: { url: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const absoluteUrl = (() => {
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    const normalized = url.startsWith("/") ? url : `/${url}`;
    if (typeof window === "undefined") return normalized;
    return new URL(normalized, window.location.origin).href;
  })();

  return (
    <button
      type="button"
      className={`${ui.btnSecondarySm} transition-colors ${
        copied
          ? "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-300"
          : ""
      } ${className ?? ""}`}
      onClick={async () => {
        const didCopy = await copyTextToClipboard(absoluteUrl);
        if (didCopy) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied!" : (label ?? "Copy URL")}
    </button>
  );
}

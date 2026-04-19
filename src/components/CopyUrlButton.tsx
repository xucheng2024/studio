"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { ui } from "@/lib/ui";

export function CopyUrlButton({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={`${ui.btnSecondarySm} transition-colors ${
        copied
          ? "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-300"
          : ""
      } ${className ?? ""}`}
      onClick={async () => {
        await navigator.clipboard.writeText(url).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied!" : "Copy URL"}
    </button>
  );
}

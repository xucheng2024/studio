"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { ui } from "@/lib/ui";

export function PaymentCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 text-xs ${
        copied
          ? "text-teal-700 dark:text-teal-400"
          : ui.linkMuted
      } transition-colors`}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy details"}
    </button>
  );
}

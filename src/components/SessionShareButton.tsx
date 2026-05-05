"use client";

import { useState } from "react";
import { Link2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ui } from "@/lib/ui";

function toAbsoluteUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return normalized;
  return new URL(normalized, window.location.origin).href;
}

export function SessionShareButton({ sharePath }: { sharePath: string | null }) {
  const [copied, setCopied] = useState(false);
  const disabled = !sharePath;

  return (
    <button
      type="button"
      disabled={disabled}
      className={`${ui.btnSecondarySm} disabled:opacity-50`}
      onClick={async () => {
        if (!sharePath) return;
        setCopied(false);
        const didCopy = await copyTextToClipboard(toAbsoluteUrl(sharePath));
        if (didCopy) {
          setCopied(true);
          toast.success("Session link copied");
          setTimeout(() => setCopied(false), 2500);
        } else {
          toast.error("Could not copy session link");
        }
      }}
    >
      {copied ? (
        <CheckCircle2 size={12} />
      ) : (
        <Link2 size={12} />
      )}
      {copied ? "Copied!" : "Copy session link"}
    </button>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ui } from "@/lib/ui";

/**
 * Browser "back" plus an explicit fallback when history is empty or user prefers a known destination.
 */
export function CheckoutReturnNav({
  fallbackHref,
  fallbackLabel,
  variant = "muted",
}: {
  fallbackHref: string;
  fallbackLabel: string;
  variant?: "muted" | "footer";
}) {
  const router = useRouter();
  const linkClass = variant === "footer" ? ui.link : ui.linkMuted;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${variant === "footer" ? "justify-center pt-1" : ""}`}>
      <button
        type="button"
        onClick={() => router.back()}
        className={`inline-flex items-center gap-1.5 text-sm ${ui.linkMuted}`}
      >
        <ArrowLeft size={14} aria-hidden />
        Previous page
      </button>
      <span className={`text-xs ${ui.muted}`} aria-hidden>
        ·
      </span>
      <Link href={fallbackHref} className={`text-sm ${linkClass}`}>
        {fallbackLabel}
      </Link>
    </div>
  );
}

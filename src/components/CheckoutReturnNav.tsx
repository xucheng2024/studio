"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const linkClass = variant === "footer" ? ui.link : ui.linkMuted;

  const handlePrevious = () => {
    if (typeof window === "undefined") {
      router.push(fallbackHref);
      return;
    }
    const ref = document.referrer;
    const sameOriginRef = ref && ref.startsWith(window.location.origin) ? new URL(ref) : null;
    const refPath = sameOriginRef?.pathname ?? "";
    const currentIsCheckout = pathname.includes("/checkout/");
    const refIsCheckoutHub = currentIsCheckout && /\/checkout\/?$/.test(refPath);
    if (refIsCheckoutHub || window.history.length <= 1) {
      router.push(fallbackHref);
      return;
    }
    router.back();
  };

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${variant === "footer" ? "justify-center pt-1" : ""}`}>
      <button
        type="button"
        onClick={handlePrevious}
        className={`inline-flex items-center gap-1.5 text-sm ${ui.linkMuted}`}
      >
        <ArrowLeft size={14} aria-hidden className="shrink-0" />
        Back
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

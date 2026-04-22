"use client";

import { usePathname } from "next/navigation";
import { isReservedPublicSlug } from "@/lib/publicStudio";

function isSharePagePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return false;

  if (normalized.startsWith("/class/")) return true;
  if (normalized.startsWith("/buy/")) return true;
  if (normalized.startsWith("/checkout/")) return true;

  if (normalized.startsWith("/booking/")) {
    const parts = normalized.split("/").filter(Boolean);
    return parts.length >= 2;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 1) {
    return !isReservedPublicSlug(parts[0] ?? "");
  }

  return false;
}

export function ConditionalSiteHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (isSharePagePath(pathname)) return null;
  return <>{children}</>;
}

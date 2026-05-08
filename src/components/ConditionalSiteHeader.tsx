"use client";

import { usePathname } from "next/navigation";
import { isReservedPublicSlug } from "@/lib/publicStudio";

function isSharePagePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return false;

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 1) {
    return !isReservedPublicSlug(parts[0] ?? "");
  }
  if (
    parts.length >= 2 &&
    !isReservedPublicSlug(parts[0] ?? "") &&
    ["classes", "events", "services", "packages", "memberships", "member-zone", "me", "checkout", "auth"].includes(parts[1] ?? "")
  ) {
    return true;
  }

  return false;
}

export function ConditionalSiteHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (isSharePagePath(pathname)) return null;
  return <>{children}</>;
}

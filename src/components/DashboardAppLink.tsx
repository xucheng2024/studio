"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isRouteActive, pathFromHref } from "@/lib/nav-active";

type Props = {
  href: string;
  className: string;
  children: React.ReactNode;
  prefetch?: boolean;
  scroll?: boolean;
};

/**
 * Next.js Link with tap feedback + optional “navigating” ring for in-dashboard navigation.
 */
export function DashboardAppLink({ href, className, children, prefetch = true, scroll = true }: Props) {
  const pathname = usePathname();
  const targetPath = pathFromHref(href);
  const active = isRouteActive(pathname, href);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const navigating = pendingPath === targetPath && !active;

  useEffect(() => {
    startTransition(() => setPendingPath(null));
  }, [pathname]);

  return (
    <Link
      href={href}
      prefetch={prefetch}
      scroll={scroll}
      onClick={() => {
        if (!active) setPendingPath(targetPath);
      }}
      className={`transition-[transform,opacity,box-shadow] duration-100 active:scale-[0.98] active:opacity-90 ${navigating ? "ring-2 ring-teal-500/45 ring-offset-1 dark:ring-offset-stone-900" : ""} ${className}`}
    >
      {children}
    </Link>
  );
}

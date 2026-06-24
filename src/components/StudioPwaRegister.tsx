"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function StudioPwaRegister({ studioSlug }: { studioSlug: string }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker
      .register("/sw.js", {
        // Register at root scope so the storefront start_url `/${studioSlug}`
        // is controlled offline in iOS home-screen launches as well.
        scope: "/",
        updateViaCache: "none",
      })
      .catch(() => {
        // Ignore registration failures so the storefront still works normally.
      });

    void navigator.serviceWorker.ready
      .then((registration) => {
        const normalizedPath = (pathname ?? "/").replace(/\/+$/, "") || "/";
        const studioRoot = `/${studioSlug}`;
        const root =
          normalizedPath === studioRoot || normalizedPath.startsWith(`${studioRoot}/`)
            ? studioRoot
            : "";
        const pageWarmupPayload = {
          type: "PREFETCH_PAGES",
          urls: [
            root || "/",
            `${root}/services`,
            `${root}/classes`,
            `${root}/events`,
            `${root}/packages`,
            `${root}/memberships`,
            `${root}/member-zone`,
            `${root}/shop`,
          ],
        };
        registration.active?.postMessage(pageWarmupPayload);
      })
      .catch(() => {
        // Ignore warmup failures and continue with normal navigation behavior.
      });
  }, [pathname, studioSlug]);

  return null;
}

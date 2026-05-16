"use client";

import { useEffect } from "react";

export function StudioPwaRegister({ studioSlug }: { studioSlug: string }) {
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
        const root = `/${studioSlug}`;
        const pageWarmupPayload = {
          type: "PREFETCH_PAGES",
          urls: [root, `${root}/packages`, `${root}/classes`, `${root}/events`, `${root}/shop`],
        };
        registration.active?.postMessage(pageWarmupPayload);
      })
      .catch(() => {
        // Ignore warmup failures and continue with normal navigation behavior.
      });
  }, [studioSlug]);

  return null;
}

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
  }, [studioSlug]);

  return null;
}

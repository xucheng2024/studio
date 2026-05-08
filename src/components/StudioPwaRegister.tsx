"use client";

import { useEffect } from "react";

export function StudioPwaRegister({ studioSlug }: { studioSlug: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const scope = `/${studioSlug}/`;
    void navigator.serviceWorker
      .register("/sw.js", {
        scope,
        updateViaCache: "none",
      })
      .catch(() => {
        // Ignore registration failures so the storefront still works normally.
      });
  }, [studioSlug]);

  return null;
}

"use client";

import { useEffect } from "react";

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void) => number;
};

function preloadImages(urls: string[]) {
  urls.forEach((url) => {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = url;
  });
}

export function StudioMediaWarmup({ urls }: { urls: string[] }) {
  useEffect(() => {
    const uniqueUrls = Array.from(
      new Set(urls.map((url) => String(url ?? "").trim()).filter(Boolean)),
    ).slice(0, 12);

    if (!uniqueUrls.length) return;

    let cancelled = false;
    const run = async () => {
      if (cancelled) return;

      const payload = { type: "PREFETCH_URLS", urls: uniqueUrls };

      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          registration.active?.postMessage(payload);
        }
      } catch {
        // Ignore service worker warmup failures and fall back to browser cache.
      }

      preloadImages(uniqueUrls);
    };

    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === "function") {
      idleWindow.requestIdleCallback(() => {
        void run();
      });
    } else {
      window.setTimeout(() => {
        void run();
      }, 1200);
    }

    return () => {
      cancelled = true;
    };
  }, [urls]);

  return null;
}

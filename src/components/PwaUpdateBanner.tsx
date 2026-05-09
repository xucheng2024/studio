"use client";

import { useEffect, useState } from "react";

export function PwaUpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATED") setShow(true);
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);

    // Also detect when a waiting SW is found
    navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setShow(true);
          }
        });
      });
    });

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-stone-100 dark:text-stone-900">
      <span>A new version is available.</span>
      <button
        type="button"
        className="rounded-lg bg-teal-500 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-400"
        onClick={async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
          window.location.reload();
        }}
      >
        Refresh
      </button>
    </div>
  );
}

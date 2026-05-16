"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";

export function PwaUpdateBanner() {
  const [show, setShow] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATED") setShow(true);
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);

    void navigator.serviceWorker.ready.then((reg) => {
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

  async function handleRefresh() {
    setRefreshing(true);
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-in slide-in-from-bottom-4 fade-in fixed bottom-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 duration-300"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-teal-200/60 bg-white/95 px-4 py-3.5 shadow-xl shadow-stone-900/10 backdrop-blur-sm dark:border-teal-800/40 dark:bg-stone-900/95">
        {/* Icon */}
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400">
          <Sparkles size={15} />
        </span>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-50">
            Update available
          </p>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            Refresh to get the latest version.
          </p>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-linear-to-r from-teal-600 to-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-teal-600/20 transition hover:from-teal-500 hover:to-cyan-500 active:scale-[0.97] disabled:opacity-60"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Updating…" : "Refresh"}
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setShow(false)}
            className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

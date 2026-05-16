"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";

export function PwaUpdateBanner() {
  const [show, setShow] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Path 1: new SW took control (replaces the dead self.addEventListener("controllerchange") in sw.js)
    const onControllerChange = () => setShow(true);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Path 2: a waiting SW is found before it activates
    let newWorker: ServiceWorker | null = null;
    const onStateChange = () => {
      if (newWorker?.state === "installed" && navigator.serviceWorker.controller) {
        setShow(true);
      }
    };
    const onUpdateFound = () => {
      newWorker = regRef.current?.installing ?? null;
      newWorker?.addEventListener("statechange", onStateChange);
    };

    void navigator.serviceWorker.ready.then((reg) => {
      regRef.current = reg;
      reg.addEventListener("updatefound", onUpdateFound);
    });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      regRef.current?.removeEventListener("updatefound", onUpdateFound);
      newWorker?.removeEventListener("statechange", onStateChange);
    };
  }, []);

  if (!show) return null;

  async function handleRefresh() {
    setRefreshing(true);
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.waiting) {
      // Wait for the new SW to take control before reloading — prevents a race
      // where location.reload() fires before skipWaiting() activates the new worker.
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
        once: true,
      });
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
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

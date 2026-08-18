"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function throttledRefresh(router: AppRouterInstance, delayMs = 800) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    router.refresh();
  }, delayMs);
}

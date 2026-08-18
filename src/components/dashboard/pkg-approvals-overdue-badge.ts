"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function usePkgApprovalsOverdueBadge() {
  const search = useSearchParams();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  const studioId = search.get("studio_id") ?? "";
  const locationId = search.get("location_id") ?? "";

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams();
    if (studioId) params.set("studio_id", studioId);
    if (locationId) params.set("location_id", locationId);

    void fetch(`/api/dashboard/nav/pkg02-backlog${params.toString() ? `?${params.toString()}` : ""}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        if (!mounted || !json || typeof json !== "object") return;
        const parsed = Number((json as { overdueCount?: unknown }).overdueCount ?? 0);
        setCount(Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0);
      })
      .catch(() => {
        if (mounted) setCount(0);
      });

    return () => {
      mounted = false;
    };
  }, [studioId, locationId, pathname]);

  return count;
}

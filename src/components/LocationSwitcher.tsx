"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ui } from "@/lib/ui";

export function LocationSwitcher({
  locations,
  selectedLocationId = null,
  allowAll = true,
}: {
  locations: { id: string; name: string }[];
  selectedLocationId?: string | null;
  allowAll?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const cookieLocation = useMemo(() => {
    if (typeof document === "undefined") return null;
    const hit = document.cookie
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("last_location_id="));
    return hit ? decodeURIComponent(hit.split("=")[1] ?? "") : null;
  }, []);
  const requestedLocationId = selectedLocationId ?? search.get("location_id") ?? cookieLocation;
  const hasRequestedLocation =
    requestedLocationId != null && locations.some((location) => location.id === requestedLocationId);
  const activeLocationId = hasRequestedLocation
    ? requestedLocationId!
    : allowAll
      ? "all"
      : (locations[0]?.id ?? "all");

  return (
    <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-stone-500">
      <span>Location</span>
      <select
        className={`${ui.select} min-w-0`}
        value={activeLocationId}
        onChange={(e) => {
          const params = new URLSearchParams(search.toString());
          if (e.target.value === "all") {
            params.delete("location_id");
            document.cookie = "last_location_id=; path=/; max-age=0";
          } else {
            params.set("location_id", e.target.value);
            document.cookie = `last_location_id=${encodeURIComponent(e.target.value)}; path=/; max-age=2592000`;
          }
          const q = params.toString();
          router.push(q ? `${pathname}?${q}` : pathname);
        }}
      >
        {allowAll ? <option value="all">All locations</option> : null}
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

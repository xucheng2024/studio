"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ui } from "@/lib/ui";

type LocationOption = {
  id: string;
  name: string;
  studio_id: string;
};

export function DashboardLocationFilter({
  locations,
  selectedStudioId,
  selectedLocationId,
  allowAll = true,
  accessibleLocationIds,
  allLabel = "All locations",
  unassignedLabel,
}: {
  locations: LocationOption[];
  selectedStudioId: string | null;
  selectedLocationId: string | null;
  allowAll?: boolean;
  accessibleLocationIds?: string[];
  allLabel?: string;
  unassignedLabel?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();

  const accessibleLocationIdSet =
    !allowAll && accessibleLocationIds ? new Set(accessibleLocationIds) : null;
  const visibleLocations = (selectedStudioId
    ? locations.filter((location) => location.studio_id === selectedStudioId)
    : locations
  ).filter((location) => !accessibleLocationIdSet || accessibleLocationIdSet.has(location.id));
  const activeValue = selectedLocationId ?? "";

  return (
    <label className="flex min-w-52 flex-col gap-1.5">
      <span className={ui.label}>Location</span>
      <select
        className={ui.select}
        value={activeValue}
        onChange={(e) => {
          const params = new URLSearchParams(search.toString());
          const nextValue = e.target.value;
          if (!nextValue) params.delete("location_id");
          else params.set("location_id", nextValue);
          const q = params.toString();
          router.push(q ? `${pathname}?${q}` : pathname);
        }}
      >
        {allowAll ? <option value="">{allLabel}</option> : null}
        {!allowAll && visibleLocations.length === 0 ? <option value="">No locations</option> : null}
        {allowAll && unassignedLabel ? <option value="__unassigned">{unassignedLabel}</option> : null}
        {visibleLocations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </label>
  );
}

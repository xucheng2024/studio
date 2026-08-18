import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ui } from "@/lib/ui";

type LocationOption = {
  id: string;
  name: string;
  studio_id: string;
};

export function PackagesLocationBar({
  locations,
  selectedStudioId,
  selectedLocationId,
  allowAll,
  accessibleLocationIds,
}: {
  locations: LocationOption[];
  selectedStudioId: string | null;
  selectedLocationId: string | null;
  allowAll: boolean;
  accessibleLocationIds?: string[];
}) {
  return (
    <div className={`${ui.card} flex flex-wrap gap-3`}>
      <DashboardLocationFilter
        locations={locations}
        selectedStudioId={selectedStudioId}
        selectedLocationId={selectedLocationId}
        allowAll={allowAll}
        accessibleLocationIds={accessibleLocationIds}
      />
    </div>
  );
}

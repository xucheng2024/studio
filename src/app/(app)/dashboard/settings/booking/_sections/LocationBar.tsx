import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ui } from "@/lib/ui";
import type { BookingSettingsContext } from "./context";

export function LocationBar({ ctx }: { ctx: BookingSettingsContext }) {
  if (ctx.locations.length <= 1) return null;
  return (
    <div className={`${ui.card} flex flex-wrap gap-3`}>
      <DashboardLocationFilter
        locations={ctx.locations}
        selectedStudioId={ctx.studioId}
        selectedLocationId={ctx.locationId}
        allowAll={false}
        accessibleLocationIds={ctx.locations.map((location) => location.id)}
      />
    </div>
  );
}

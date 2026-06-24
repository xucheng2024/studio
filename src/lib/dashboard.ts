import { buildAccessContext, filterStudioIdsByRoles, type StaffRole } from "@/lib/rbac";
import { cookies } from "next/headers";

export async function getDashboardScope(params: {
  userId: string;
  email?: string | null;
  studioId?: string | null;
  locationId?: string | null;
}) {
  const c = await cookies();
  const studioIdInput = params.studioId ?? c.get("last_studio_id")?.value ?? null;
  const locationIdInput = params.locationId ?? c.get("last_location_id")?.value ?? null;
  const ctx = await buildAccessContext(
    params.userId,
    params.email ?? null,
    locationIdInput,
  );

  const allStudioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  const studioIds =
    studioIdInput && allStudioIds.includes(studioIdInput) ? [studioIdInput] : allStudioIds;
  const selectedStudioId = studioIds.length === 1 ? studioIds[0] : null;
  const selectedLocationId =
    ctx.selectedLocationId &&
    ctx.locations.some(
      (l) => l.id === ctx.selectedLocationId && (selectedStudioId ? l.studio_id === selectedStudioId : true),
    )
      ? ctx.selectedLocationId
      : null;

  return { ctx, studioIds, selectedStudioId, selectedLocationId };
}

export async function getDashboardScopeForRoles(
  params: {
    userId: string;
    email?: string | null;
    studioId?: string | null;
    locationId?: string | null;
  },
  roles: StaffRole[],
) {
  const scope = await getDashboardScope(params);
  const studioIds = filterStudioIdsByRoles(scope.ctx, scope.studioIds, roles);
  const selectedStudioId =
    scope.selectedStudioId && studioIds.includes(scope.selectedStudioId)
      ? scope.selectedStudioId
      : studioIds.length === 1
        ? studioIds[0]
        : null;
  const selectedLocationId =
    scope.selectedLocationId &&
    scope.ctx.locations.some(
      (location) =>
        location.id === scope.selectedLocationId &&
        studioIds.includes(location.studio_id) &&
        (selectedStudioId ? location.studio_id === selectedStudioId : true),
    )
      ? scope.selectedLocationId
      : null;

  return {
    ...scope,
    studioIds,
    selectedStudioId,
    selectedLocationId,
  };
}

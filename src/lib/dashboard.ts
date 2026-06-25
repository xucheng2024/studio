import { buildAccessContext, filterStudioIdsByRoles, type AccessContext, type StaffRole } from "@/lib/rbac";
import { cookies } from "next/headers";

function resolveLocationScope(
  ctx: AccessContext,
  studioIds: string[],
  selectedStudioId: string | null,
  roles?: StaffRole[],
) {
  const studioIdSet = new Set(studioIds);
  const scopedMemberships = ctx.memberships.filter(
    (membership) =>
      studioIdSet.has(membership.studio_id) && (!roles || roles.includes(membership.role)),
  );
  const relevantStudioIds = selectedStudioId ? [selectedStudioId] : studioIds;
  const unrestrictedStudioIds = new Set(
    scopedMemberships
      .filter(
        (membership) =>
          membership.location_id == null && relevantStudioIds.includes(membership.studio_id),
      )
      .map((membership) => membership.studio_id),
  );
  const accessibleLocationIds = ctx.locations
    .filter(
      (location) =>
        relevantStudioIds.includes(location.studio_id) &&
        (unrestrictedStudioIds.has(location.studio_id) ||
          scopedMemberships.some(
            (membership) =>
              membership.studio_id === location.studio_id &&
              membership.location_id === location.id,
          )),
    )
    .map((location) => location.id);
  const uniqueAccessibleLocationIds = [...new Set(accessibleLocationIds)];
  const requestedLocationId =
    ctx.selectedLocationId && uniqueAccessibleLocationIds.includes(ctx.selectedLocationId)
      ? ctx.selectedLocationId
      : null;
  const shouldAutoSelectRestrictedLocation =
    selectedStudioId != null &&
    !unrestrictedStudioIds.has(selectedStudioId) &&
    uniqueAccessibleLocationIds.length > 0;

  return {
    accessibleLocationIds: uniqueAccessibleLocationIds,
    selectedLocationId:
      requestedLocationId ??
      (shouldAutoSelectRestrictedLocation ? uniqueAccessibleLocationIds[0] : null),
  };
}

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
  const locationScope = resolveLocationScope(ctx, studioIds, selectedStudioId);

  return {
    ctx,
    studioIds,
    selectedStudioId,
    selectedLocationId: locationScope.selectedLocationId,
    accessibleLocationIds: locationScope.accessibleLocationIds,
  };
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
  const locationScope = resolveLocationScope(
    scope.ctx,
    studioIds,
    selectedStudioId,
    roles,
  );

  return {
    ...scope,
    studioIds,
    selectedStudioId,
    selectedLocationId: locationScope.selectedLocationId,
    accessibleLocationIds: locationScope.accessibleLocationIds,
  };
}

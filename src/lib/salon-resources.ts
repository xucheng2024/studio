import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { requireStaffScope, type StaffScopeFailureReason } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export type ResourceType = "room" | "bed" | "equipment" | "other";

export type SalonResource = {
  id: string;
  studio_id: string;
  location_id: string;
  name: string;
  resource_type: ResourceType;
  is_active: boolean;
  capacity: number;
  created_at: string;
  updated_at: string;
};

const READ_ROLES = ["owner", "manager", "frontdesk"] as const;
const WRITE_GLOBAL_ROLES = ["owner", "manager"] as const;

function hasGlobalReadAccess(
  memberships: Array<{ studio_id: string; location_id: string | null; role: string }>,
  studioId: string,
) {
  return memberships.some(
    (membership) =>
      membership.studio_id === studioId &&
      membership.location_id == null &&
      (membership.role === "owner" || membership.role === "manager"),
  );
}

/**
 * List a location's resources (rooms/beds/equipment), scoped to the
 * caller's studio/location access. Owners and all-location managers can
 * read any location; a Location Manager (or Frontdesk) may only read a
 * location they are authorised for.
 */
export async function listSalonResources(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId: string;
}): Promise<{ ok: true; resources: SalonResource[] } | { ok: false; reason: "forbidden" }> {
  const scope = await getDashboardScopeForRoles(
    {
      userId: params.userId,
      email: params.email ?? null,
      studioId: params.studioId,
      locationId: params.locationId,
    },
    [...READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }
  if (
    !hasGlobalReadAccess(scope.ctx.memberships, params.studioId) &&
    !scope.accessibleLocationIds.includes(params.locationId)
  ) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("salon_resources")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("location_id", params.locationId)
    .order("resource_type")
    .order("name")
    .returns<SalonResource[]>();
  if (error) throw error;
  return { ok: true, resources: data ?? [] };
}

/**
 * Create a new resource, or update an existing one when resourceId is
 * given, via the upsert_salon_resource RPC. Owner/all-location Manager can
 * target any location; a Location Manager may only target their own
 * authorised location. Never hard-deletes — use setSalonResourceActive to
 * retire a resource while preserving history.
 */
export async function upsertSalonResource(params: {
  userId: string;
  studioId: string;
  locationId: string;
  name: string;
  resourceType: ResourceType;
  capacity?: number;
  resourceId?: string | null;
}): Promise<
  | { ok: true; resourceId: string }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request" | "not_found"; message?: string }
> {
  const admin = createAdminClient();
  let actorRole: "owner" | "manager";

  if (params.resourceId) {
    const { data: existing, error: fetchError } = await admin
      .from("salon_resources")
      .select("id, location_id")
      .eq("id", params.resourceId)
      .eq("studio_id", params.studioId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return { ok: false, reason: "not_found", message: "Resource was not found." };

    const currentScope = await requireStaffScope({
      userId: params.userId,
      studioId: params.studioId,
      locationId: existing.location_id,
      roles: [...WRITE_GLOBAL_ROLES],
    });
    if (!currentScope.ok) return currentScope;

    if (existing.location_id !== params.locationId) {
      const targetScope = await requireStaffScope({
        userId: params.userId,
        studioId: params.studioId,
        locationId: params.locationId,
        roles: [...WRITE_GLOBAL_ROLES],
      });
      if (!targetScope.ok) return targetScope;
    }

    actorRole = currentScope.role;

    const { data, error } = await admin
      .rpc("upsert_salon_resource_strict", {
        p_actor_id: params.userId,
        p_actor_role: actorRole,
        p_studio_id: params.studioId,
        p_location_id: params.locationId,
        p_name: params.name,
        p_resource_type: params.resourceType,
        p_capacity: params.capacity ?? 1,
        p_resource_id: params.resourceId,
        p_expected_current_location_id: existing.location_id,
      })
      .single<{ ok: true; resource_id: string }>();
    if (error) return { ok: false, reason: "invalid_request", message: error.message };
    return { ok: true, resourceId: data.resource_id };
  } else {
    const createScope = await requireStaffScope({
      userId: params.userId,
      studioId: params.studioId,
      locationId: params.locationId,
      roles: [...WRITE_GLOBAL_ROLES],
    });
    if (!createScope.ok) return createScope;
    actorRole = createScope.role;
  }

  const { data, error } = await admin
    .rpc("upsert_salon_resource", {
      p_actor_id: params.userId,
      p_actor_role: actorRole,
      p_studio_id: params.studioId,
      p_location_id: params.locationId,
      p_name: params.name,
      p_resource_type: params.resourceType,
      p_capacity: params.capacity ?? 1,
      p_resource_id: params.resourceId ?? null,
    })
    .single<{ ok: true; resource_id: string }>();
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true, resourceId: data.resource_id };
}

/**
 * Activate/deactivate a resource via the set_salon_resource_active RPC.
 * Scope is derived from the resource's own location_id, same rule as
 * upsertSalonResource.
 */
export async function setSalonResourceActive(params: {
  userId: string;
  studioId: string;
  resourceId: string;
  isActive: boolean;
}): Promise<
  | { ok: true }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request" | "not_found"; message?: string }
> {
  const admin = createAdminClient();
  const { data: existing, error: fetchError } = await admin
    .from("salon_resources")
    .select("id, location_id")
    .eq("id", params.resourceId)
    .eq("studio_id", params.studioId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return { ok: false, reason: "not_found" };

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: existing.location_id,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const { error } = await admin.rpc("set_salon_resource_active", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_resource_id: params.resourceId,
    p_is_active: params.isActive,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

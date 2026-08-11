import { getDashboardScopeForRoles } from "@/lib/dashboard";
import {
  requireGlobalStaffScope,
  requireStaffScope,
  type StaffScopeFailureReason,
} from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export type PublishScope = "all_locations" | "selected_locations";
export type PropagationMode = "hq_only" | "all_locations" | "selected_locations";

export type ServiceLocation = {
  id: string;
  service_id: string;
  location_id: string;
  studio_id: string;
  is_enabled: boolean;
  uses_default_values: boolean;
  price_override: number | null;
  duration_override_minutes: number | null;
  buffer_override_minutes: number | null;
  created_at: string;
  updated_at: string;
};

export type ServiceLocationAuditEntry = {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  actor_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
};

const READ_ROLES = ["owner", "manager", "frontdesk"] as const;
const WRITE_GLOBAL_ROLES = ["owner", "manager"] as const;

function hasGlobalServiceLocationReadAccess(
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
 * List service_locations rows for one service, scoped to the caller's
 * studio/location access. Owners and all-location managers see every
 * location; location-scoped staff only see their authorised locations.
 */
export async function listServiceLocationsForService(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  serviceId: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; serviceLocations: ServiceLocation[] }
  | { ok: false; reason: "forbidden" }
> {
  const scope = await getDashboardScopeForRoles(
    {
      userId: params.userId,
      email: params.email ?? null,
      studioId: params.studioId,
      locationId: params.locationId ?? null,
    },
    [...READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const hasGlobalAccess = hasGlobalServiceLocationReadAccess(scope.ctx.memberships, params.studioId);

  let query = admin
    .from("service_locations")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("service_id", params.serviceId);

  if (!hasGlobalAccess) {
    if (scope.accessibleLocationIds.length === 0) {
      return { ok: true, serviceLocations: [] };
    }
    query = query.in("location_id", scope.accessibleLocationIds);
  }

  const { data, error } = await query.returns<ServiceLocation[]>();
  if (error) throw error;
  return { ok: true, serviceLocations: data ?? [] };
}

/**
 * List every service_locations row within the caller's authorised studio/
 * location scope, across all services (e.g. for a per-location catalog view).
 */
export async function listServiceLocationsForStudio(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; serviceLocations: ServiceLocation[] }
  | { ok: false; reason: "forbidden" }
> {
  const scope = await getDashboardScopeForRoles(
    {
      userId: params.userId,
      email: params.email ?? null,
      studioId: params.studioId,
      locationId: params.locationId ?? null,
    },
    [...READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const hasGlobalAccess = hasGlobalServiceLocationReadAccess(scope.ctx.memberships, params.studioId);

  let query = admin.from("service_locations").select("*").eq("studio_id", params.studioId);

  if (!hasGlobalAccess) {
    if (scope.accessibleLocationIds.length === 0) {
      return { ok: true, serviceLocations: [] };
    }
    query = query.in("location_id", scope.accessibleLocationIds);
  }

  const { data, error } = await query.returns<ServiceLocation[]>();
  if (error) throw error;
  return { ok: true, serviceLocations: data ?? [] };
}

/**
 * Set a service's publish scope (all locations vs a selected list) via the
 * set_service_publish_scope RPC. Studio-wide operation: Owner or an
 * all-location Manager only — a Location Manager cannot decide where a
 * service is published studio-wide, only toggle it at their own location
 * (see setServiceLocationEnabled).
 */
export async function setServicePublishScope(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  scope: PublishScope;
  locationIds?: string[] | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_service_publish_scope", {
    p_actor_id: params.userId,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_scope: params.scope,
    p_location_ids: params.locationIds ?? null,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Enable/disable a service at one location via the
 * set_service_location_enabled RPC. Owner/all-location Manager can target
 * any location; a Location Manager may only target a location they are
 * scoped to (requireStaffScope enforces this — owner and location_id=null
 * managers pass unconditionally, a location-scoped manager only passes when
 * locationId matches their membership).
 */
export async function setServiceLocationEnabled(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  locationId: string;
  isEnabled: boolean;
}): Promise<
  | { ok: true }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_service_location_enabled", {
    p_actor_id: params.userId,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_location_id: params.locationId,
    p_is_enabled: params.isEnabled,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Set (or clear) a location's price/duration/buffer override for a service
 * via the set_service_location_override RPC. Same scope rule as
 * setServiceLocationEnabled.
 */
export async function setServiceLocationOverride(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  locationId: string;
  usesDefaultValues: boolean;
  priceOverride?: number | null;
  durationOverrideMinutes?: number | null;
  bufferOverrideMinutes?: number | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_service_location_override", {
    p_actor_id: params.userId,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_location_id: params.locationId,
    p_uses_default_values: params.usesDefaultValues,
    p_price_override: params.priceOverride ?? null,
    p_duration_override_minutes: params.durationOverrideMinutes ?? null,
    p_buffer_override_minutes: params.bufferOverrideMinutes ?? null,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Update a service's HQ default price and choose how it propagates to
 * per-location overrides, via the update_studio_service_default_price RPC.
 * Studio-wide operation: Owner or an all-location Manager only.
 */
export async function updateStudioServiceDefaultPrice(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  price: number | null;
  propagationMode: PropagationMode;
  locationIds?: string[] | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("update_studio_service_default_price", {
    p_actor_id: params.userId,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_price: params.price,
    p_propagation_mode: params.propagationMode,
    p_location_ids: params.locationIds ?? null,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Read the operation_audits trail for a service's publish/override history.
 * Owners and all-location managers see every entry for the studio;
 * location-scoped managers only see entries whose recorded location_id is
 * one of their authorised locations (HQ-level entries, which have no
 * location_id, are visible to everyone with studio read access since they
 * affect every location's default).
 */
export async function getServiceLocationAuditTrail(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  serviceId: string;
}): Promise<
  | { ok: true; entries: ServiceLocationAuditEntry[] }
  | { ok: false; reason: "forbidden" }
> {
  const scope = await getDashboardScopeForRoles(
    { userId: params.userId, email: params.email ?? null, studioId: params.studioId, locationId: null },
    [...READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const { data: service, error: serviceError } = await admin
    .from("studio_services")
    .select("id")
    .eq("id", params.serviceId)
    .eq("studio_id", params.studioId)
    .maybeSingle();
  if (serviceError) throw serviceError;
  if (!service) return { ok: false, reason: "forbidden" };

  const hasGlobalAccess = hasGlobalServiceLocationReadAccess(scope.ctx.memberships, params.studioId);

  const { data, error } = await admin
    .from("operation_audits")
    .select("id, action, target_type, target_id, actor_id, before_state, after_state, created_at")
    .in("target_type", ["service_location", "studio_service"])
    .contains("after_state", { studio_id: params.studioId, service_id: params.serviceId })
    .order("created_at", { ascending: false })
    .returns<ServiceLocationAuditEntry[]>();
  if (error) throw error;

  const entries = data ?? [];
  if (hasGlobalAccess) return { ok: true, entries };

  const accessibleLocationIds = new Set(scope.accessibleLocationIds);
  const filtered = entries.filter((entry) => {
    const locationId = (entry.after_state?.location_id ?? entry.before_state?.location_id) as
      | string
      | undefined;
    if (!locationId) return true; // HQ-level entry: visible to all studio readers
    return accessibleLocationIds.has(locationId);
  });
  return { ok: true, entries: filtered };
}

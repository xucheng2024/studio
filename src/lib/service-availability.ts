import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { requireGlobalStaffScope, type StaffScopeFailureReason } from "@/lib/scope";
import {
  firstQueryError,
  getOccupiedWindowMs,
  isSameSgtDate,
  resolveUnifiedAvailabilityFromSnapshot,
  toSeconds,
} from "@/lib/service-availability-logic.mjs";
import { createAdminClient } from "@/lib/supabase/admin";

export type ResourceType = "room" | "bed" | "equipment" | "other";

export type ServiceEmployee = {
  id: string;
  studio_id: string;
  service_id: string;
  employee_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ServiceAvailabilityDefaults = {
  default_duration_minutes: number;
  default_prep_minutes: number;
  default_buffer_minutes: number;
};

export type ServiceLocationAvailabilityOverride = {
  duration_override_minutes: number | null;
  buffer_override_minutes: number | null;
};

export type EffectiveServiceAvailability = {
  effectiveDurationMinutes: number;
  effectivePrepMinutes: number;
  effectiveBufferMinutes: number;
};

export type ServiceResourceRequirement = {
  id: string;
  studio_id: string;
  service_id: string;
  resource_type: ResourceType;
  required_quantity: number;
  created_at: string;
  updated_at: string;
};

export type ServiceResourceRequirementInput = {
  resourceType: ResourceType;
  requiredQuantity: number | null;
};

export type ServiceEmployeeAvailabilityCandidate = {
  employeeId: string;
  hasLocationAssignment: boolean;
  hasServiceEligibility: boolean;
  withinLocationOperatingHours: boolean;
  withinWorkingHours: boolean;
  hasAvailableException: boolean;
  hasUnavailableException: boolean;
  isAvailable: boolean;
};

export type ServiceAvailabilityResolution = {
  effectiveDurationMinutes: number;
  effectivePrepMinutes: number;
  effectiveBufferMinutes: number;
};

export type EligibleEmployeesForServiceAtLocationResult = {
  serviceEnabledAtLocation: boolean;
  withinLocationOperatingHours: boolean;
  availability: ServiceAvailabilityResolution;
  candidates: ServiceEmployeeAvailabilityCandidate[];
};

const SGT_TIME_ZONE = "Asia/Singapore";

function formatSgtHm(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: SGT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((part) => part.type === "hour")?.value;
  const mm = parts.find((part) => part.type === "minute")?.value;
  if (!hh || !mm) return null;
  return `${hh}:${mm}`;
}

function formatSgtWeekday(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: SGT_TIME_ZONE,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[short] ?? null;
}

function formatSgtDateYmd(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SGT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

const READ_ROLES = ["owner", "manager", "frontdesk"] as const;
const WRITE_GLOBAL_ROLES = ["owner", "manager"] as const;

/**
 * Resolve the effective duration/prep/buffer for a service at a location.
 * Duration and buffer fall back from the location's service_locations
 * override (FND-03) to the studio's HQ default (this task); prep time is
 * HQ-only, since no per-location prep override exists. Pure function — the
 * caller is responsible for fetching studio_services and service_locations
 * rows; this never touches the database itself.
 */
export function getEffectiveServiceAvailability(
  defaults: ServiceAvailabilityDefaults,
  override: ServiceLocationAvailabilityOverride | null,
): EffectiveServiceAvailability {
  return {
    effectiveDurationMinutes: override?.duration_override_minutes ?? defaults.default_duration_minutes,
    effectivePrepMinutes: defaults.default_prep_minutes,
    effectiveBufferMinutes: override?.buffer_override_minutes ?? defaults.default_buffer_minutes,
  };
}

/**
 * List service_employees relations for one service, scoped to the caller's
 * studio access. service_employees is studio-wide (no location column), so
 * any authorised reader in the studio sees the full list; narrowing to
 * "which of these employees can work this service at location X" is a
 * separate join against employee_locations/service_locations done by the
 * caller (e.g. by APT-02), not a concern of this table.
 */
export async function listServiceEmployees(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  serviceId: string;
}): Promise<{ ok: true; serviceEmployees: ServiceEmployee[] } | { ok: false; reason: "forbidden" }> {
  const scope = await getDashboardScopeForRoles(
    { userId: params.userId, email: params.email ?? null, studioId: params.studioId, locationId: null },
    [...READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("service_employees")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("service_id", params.serviceId)
    .returns<ServiceEmployee[]>();
  if (error) throw error;
  return { ok: true, serviceEmployees: data ?? [] };
}

/**
 * Set (or clear) whether an employee is eligible to provide a service, via
 * the set_service_employee_eligibility RPC. Studio-wide operation: Owner or
 * an all-location Manager only — a Location Manager must not change
 * studio-wide service eligibility.
 */
export async function setServiceEmployeeEligibility(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  employeeId: string;
  isActive: boolean;
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_service_employee_eligibility", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_employee_id: params.employeeId,
    p_is_active: params.isActive,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Atomically replace a service's eligible-employee set.
 */
export async function setServiceEmployeeEligibilities(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  employeeIds: string[];
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_service_employee_eligibilities", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_employee_ids: params.employeeIds,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Update a service's HQ default standard duration / prep time / cleanup
 * buffer via the update_studio_service_availability_defaults RPC.
 * Studio-wide operation: Owner or an all-location Manager only.
 */
export async function updateStudioServiceAvailabilityDefaults(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  defaultDurationMinutes: number;
  defaultPrepMinutes: number;
  defaultBufferMinutes: number;
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("update_studio_service_availability_defaults", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_default_duration_minutes: params.defaultDurationMinutes,
    p_default_prep_minutes: params.defaultPrepMinutes,
    p_default_buffer_minutes: params.defaultBufferMinutes,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * List a service's resource-type requirements, scoped to the caller's
 * studio access.
 */
export async function listServiceResourceRequirements(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  serviceId: string;
}): Promise<
  { ok: true; requirements: ServiceResourceRequirement[] } | { ok: false; reason: "forbidden" }
> {
  const scope = await getDashboardScopeForRoles(
    { userId: params.userId, email: params.email ?? null, studioId: params.studioId, locationId: null },
    [...READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("service_resource_requirements")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("service_id", params.serviceId)
    .returns<ServiceResourceRequirement[]>();
  if (error) throw error;
  return { ok: true, requirements: data ?? [] };
}

/**
 * Set (or, when requiredQuantity is null, remove) how many of a resource
 * type a service requires, via the set_service_resource_requirement RPC.
 * Studio-wide operation: Owner or an all-location Manager only.
 */
export async function setServiceResourceRequirement(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  resourceType: ResourceType;
  requiredQuantity: number | null;
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_service_resource_requirement", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_resource_type: params.resourceType,
    p_required_quantity: params.requiredQuantity,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Atomically set multiple resource requirements for one service in a single
 * transaction via set_service_resource_requirements RPC.
 */
export async function setServiceResourceRequirements(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  requirements: ServiceResourceRequirementInput[];
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const payload = params.requirements.map((entry) => ({
    resource_type: entry.resourceType,
    required_quantity: entry.requiredQuantity,
  }));
  const { error } = await admin.rpc("set_service_resource_requirements", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_service_id: params.serviceId,
    p_requirements: payload,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Unified availability view for APT-02 critical intersection:
 * service enabled at location ∩ active employee-location assignment ∩
 * active service eligibility ∩ working-hours/exceptions for a target slot.
 */
export async function getEligibleEmployeesForServiceAtLocation(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  serviceId: string;
  locationId: string;
  startsAtIso: string;
  endsAtIso: string;
}): Promise<
  | {
      ok: true;
      result: EligibleEmployeesForServiceAtLocationResult;
    }
  | { ok: false; reason: "forbidden" | "invalid_request"; message?: string }
> {
  const start = new Date(params.startsAtIso);
  const end = new Date(params.endsAtIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { ok: false, reason: "invalid_request", message: "Invalid startsAt or endsAt." };
  }

  const startDateYmd = formatSgtDateYmd(start);
  if (startDateYmd == null) {
    return { ok: false, reason: "invalid_request", message: "Could not parse time in SGT." };
  }

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

  const hasGlobalAccess = scope.ctx.memberships.some(
    (membership) =>
      membership.studio_id === params.studioId
      && membership.location_id == null
      && (membership.role === "owner" || membership.role === "manager"),
  );
  if (!hasGlobalAccess && !scope.accessibleLocationIds.includes(params.locationId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const [serviceLocationRes, defaultsRes, locationRes] = await Promise.all([
    admin
      .from("service_locations")
      .select("is_enabled, duration_override_minutes, buffer_override_minutes")
      .eq("studio_id", params.studioId)
      .eq("service_id", params.serviceId)
      .eq("location_id", params.locationId)
      .maybeSingle<{ is_enabled: boolean; duration_override_minutes: number | null; buffer_override_minutes: number | null }>(),
    admin
      .from("studio_services")
      .select("is_active, default_duration_minutes, default_prep_minutes, default_buffer_minutes")
      .eq("studio_id", params.studioId)
      .eq("id", params.serviceId)
      .maybeSingle<{
        is_active: boolean;
        default_duration_minutes: number;
        default_prep_minutes: number;
        default_buffer_minutes: number;
      }>(),
    admin
      .from("locations")
      .select("id, is_active")
      .eq("studio_id", params.studioId)
      .eq("id", params.locationId)
      .maybeSingle<{ id: string; is_active: boolean }>(),
  ]);

  const queryError = firstQueryError([
    { name: "service_locations", error: serviceLocationRes.error },
    { name: "studio_services", error: defaultsRes.error },
    { name: "locations", error: locationRes.error },
  ]);
  if (queryError) {
    return {
      ok: false,
      reason: "invalid_request",
      message: `${queryError.query} query failed: ${queryError.message}`,
    };
  }

  const serviceLocation = serviceLocationRes.data;
  const defaultsRow = defaultsRes.data;
  const locationRow = locationRes.data;

  if (!defaultsRow) {
    return { ok: false, reason: "invalid_request", message: "Service not found in studio." };
  }
  if (!locationRow) {
    return { ok: false, reason: "invalid_request", message: "Location not found in studio." };
  }

  const effective = getEffectiveServiceAvailability(
    {
      default_duration_minutes: defaultsRow?.default_duration_minutes ?? 60,
      default_prep_minutes: defaultsRow?.default_prep_minutes ?? 0,
      default_buffer_minutes: defaultsRow?.default_buffer_minutes ?? 0,
    },
    serviceLocation
      ? {
          duration_override_minutes: serviceLocation.duration_override_minutes,
          buffer_override_minutes: serviceLocation.buffer_override_minutes,
        }
      : null,
  );

  const occupiedWindow = getOccupiedWindowMs(
    start.getTime(),
    end.getTime(),
    effective.effectivePrepMinutes,
    effective.effectiveBufferMinutes,
  );
  if (!occupiedWindow) {
    return { ok: false, reason: "invalid_request", message: "Invalid occupied time range." };
  }
  const occupiedStart = new Date(occupiedWindow.startMs);
  const occupiedEnd = new Date(occupiedWindow.endMs);
  const occupiedStartWeekday = formatSgtWeekday(occupiedStart);
  const occupiedEndWeekday = formatSgtWeekday(occupiedEnd);
  const occupiedStartHm = formatSgtHm(occupiedStart);
  const occupiedEndHm = formatSgtHm(occupiedEnd);
  if (occupiedStartWeekday == null || occupiedEndWeekday == null || occupiedStartHm == null || occupiedEndHm == null) {
    return { ok: false, reason: "invalid_request", message: "Could not parse occupied time in SGT." };
  }
  if (!isSameSgtDate(occupiedWindow.startMs, occupiedWindow.endMs) || occupiedStartWeekday !== occupiedEndWeekday) {
    return {
      ok: false,
      reason: "invalid_request",
      message: "Cross-day occupied windows are not supported by this availability resolver.",
    };
  }
  const occupiedStartSeconds = toSeconds(occupiedStartHm);
  const occupiedEndSeconds = toSeconds(occupiedEndHm);
  if (occupiedStartSeconds == null || occupiedEndSeconds == null || occupiedEndSeconds <= occupiedStartSeconds) {
    return { ok: false, reason: "invalid_request", message: "Invalid occupied time range in SGT." };
  }

  const occupiedStartsAtIso = occupiedStart.toISOString();
  const occupiedEndsAtIso = occupiedEnd.toISOString();
  const [locationAssignmentsRes, serviceEmployeesRes, workingHoursRes, exceptionsRes, locationHoursRes] = await Promise.all([
    admin
      .from("employee_locations")
      .select("employee_id")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .eq("is_active", true),
    admin
      .from("service_employees")
      .select("employee_id")
      .eq("studio_id", params.studioId)
      .eq("service_id", params.serviceId)
      .eq("is_active", true),
    admin
      .from("employee_working_hours")
      .select("employee_id, starts_at, ends_at, effective_from, effective_until")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .eq("weekday", occupiedStartWeekday)
      .eq("is_active", true),
    admin
      .from("employee_availability_exceptions")
      .select("employee_id, location_id, exception_type, starts_at, ends_at")
      .eq("studio_id", params.studioId)
      .lt("starts_at", occupiedEndsAtIso)
      .gt("ends_at", occupiedStartsAtIso)
      .or(`location_id.is.null,location_id.eq.${params.locationId}`),
    admin
      .from("location_operating_hours")
      .select("is_closed, opens_at, closes_at")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .eq("weekday", occupiedStartWeekday),
  ]);

  const followupQueryError = firstQueryError([
    { name: "employee_locations", error: locationAssignmentsRes.error },
    { name: "service_employees", error: serviceEmployeesRes.error },
    { name: "employee_working_hours", error: workingHoursRes.error },
    { name: "employee_availability_exceptions", error: exceptionsRes.error },
    { name: "location_operating_hours", error: locationHoursRes.error },
  ]);
  if (followupQueryError) {
    return {
      ok: false,
      reason: "invalid_request",
      message: `${followupQueryError.query} query failed: ${followupQueryError.message}`,
    };
  }

  const locationAssignments = locationAssignmentsRes.data ?? [];
  const serviceEmployees = serviceEmployeesRes.data ?? [];
  const workingHours = workingHoursRes.data ?? [];
  const exceptions = exceptionsRes.data ?? [];
  const locationHours = locationHoursRes.data ?? [];

  const allEmployeeIds = new Set<string>([
    ...locationAssignments.map((row) => row.employee_id),
    ...serviceEmployees.map((row) => row.employee_id),
  ]);

  const employeesLookup = new Map<string, { is_active: boolean; employment_status: string }>();
  if (allEmployeeIds.size > 0) {
    const { data: employees, error: employeesError } = await admin
      .from("employees")
      .select("id, is_active, employment_status")
      .eq("studio_id", params.studioId)
      .in("id", [...allEmployeeIds])
      .returns<Array<{ id: string; is_active: boolean; employment_status: string }>>();
    if (employeesError) {
      return {
        ok: false,
        reason: "invalid_request",
        message: `employees query failed: ${employeesError.message}`,
      };
    }
    for (const row of employees ?? []) {
      employeesLookup.set(row.id, {
        is_active: row.is_active,
        employment_status: row.employment_status,
      });
    }
  }

  const resolved = resolveUnifiedAvailabilityFromSnapshot({
    serviceLocation,
    studioService: defaultsRow,
    location: locationRow,
    locationHours,
    locationAssignments,
    serviceEmployees,
    workingHours,
    exceptions,
    employeesLookup,
    startDateYmd,
    occupiedWindow,
    occupiedStartSeconds,
    occupiedEndSeconds,
  });

  const candidates: ServiceEmployeeAvailabilityCandidate[] = resolved.candidates;

  return {
    ok: true,
    result: {
      serviceEnabledAtLocation: resolved.serviceEnabledAtLocation,
      withinLocationOperatingHours: resolved.withinLocationOperatingHours,
      availability: {
        effectiveDurationMinutes: effective.effectiveDurationMinutes,
        effectivePrepMinutes: effective.effectivePrepMinutes,
        effectiveBufferMinutes: effective.effectiveBufferMinutes,
      },
      candidates,
    },
  };
}

export async function checkEmployeeAvailability(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  serviceId: string;
  locationId: string;
  employeeId: string;
  startsAtIso: string;
  endsAtIso: string;
}): Promise<
  | {
      ok: true;
      result: EligibleEmployeesForServiceAtLocationResult;
      employee: ServiceEmployeeAvailabilityCandidate | null;
    }
  | { ok: false; reason: "forbidden" | "invalid_request"; message?: string }
> {
  const result = await getEligibleEmployeesForServiceAtLocation(params);
  if (!result.ok) return result;
  return {
    ok: true,
    result: result.result,
    employee: result.result.candidates.find((candidate) => candidate.employeeId === params.employeeId) ?? null,
  };
}

export const getServiceEmployeeAvailabilityAtLocation = getEligibleEmployeesForServiceAtLocation;

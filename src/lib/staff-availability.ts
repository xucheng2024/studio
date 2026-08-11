import { getDashboardScopeForRoles } from "@/lib/dashboard";
import {
  requireGlobalStaffScope,
  requireStaffScope,
  type StaffScopeFailureReason,
} from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export type LocationOperatingHours = {
  id: string;
  studio_id: string;
  location_id: string;
  weekday: number;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OperatingHoursInterval = { opens_at: string; closes_at: string };

export type EmployeeWorkingHours = {
  id: string;
  studio_id: string;
  employee_id: string;
  location_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  effective_from: string | null;
  effective_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkingHoursInterval = { starts_at: string; ends_at: string };
export type WorkingHoursWeekdayInput = {
  weekday: number;
  intervals: WorkingHoursInterval[];
};
export type OperatingHoursWeekdayInput = {
  weekday: number;
  isClosed: boolean;
  intervals: OperatingHoursInterval[];
};

export type ExceptionType = "unavailable" | "available";
export type ExceptionReasonCategory =
  | "break"
  | "leave"
  | "training"
  | "meeting"
  | "overtime"
  | "other";

export type EmployeeAvailabilityException = {
  id: string;
  studio_id: string;
  employee_id: string;
  location_id: string | null;
  exception_type: ExceptionType;
  reason_category: ExceptionReasonCategory;
  starts_at: string;
  ends_at: string;
  reason: string | null;
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
 * List a location's operating hours, scoped to the caller's studio/location
 * access. Owners and all-location managers can read any location; a
 * Location Manager (or Frontdesk) may only read a location they are
 * authorised for.
 */
export async function listLocationOperatingHours(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId: string;
}): Promise<
  { ok: true; hours: LocationOperatingHours[] } | { ok: false; reason: "forbidden" }
> {
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
    .from("location_operating_hours")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("location_id", params.locationId)
    .order("weekday")
    .order("opens_at")
    .returns<LocationOperatingHours[]>();
  if (error) throw error;
  return { ok: true, hours: data ?? [] };
}

/**
 * Replace a location's operating-hour intervals for one weekday via the
 * set_location_operating_hours_for_weekday RPC (atomic replace, rejects
 * overlapping intervals). Owner/all-location Manager can target any
 * location; a Location Manager may only target their own authorised
 * location (requireStaffScope enforces this).
 */
export async function setLocationOperatingHoursForWeekday(params: {
  userId: string;
  studioId: string;
  locationId: string;
  weekday: number;
  isClosed: boolean;
  intervals: OperatingHoursInterval[];
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_location_operating_hours_for_weekday", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_location_id: params.locationId,
    p_weekday: params.weekday,
    p_is_closed: params.isClosed,
    p_intervals: params.intervals,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Atomic weekly replace wrapper for location operating hours.
 * All submitted weekdays are validated and persisted in one database
 * transaction by the set_location_operating_hours_for_week RPC.
 */
export async function setLocationOperatingHoursForWeek(params: {
  userId: string;
  studioId: string;
  locationId: string;
  days: OperatingHoursWeekdayInput[];
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const payload = params.days.map((day) => ({
    weekday: day.weekday,
    is_closed: day.isClosed,
    intervals: day.intervals,
  }));
  const { error } = await admin.rpc("set_location_operating_hours_for_week", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_location_id: params.locationId,
    p_days: payload,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * List an employee's recurring working hours, optionally narrowed to one
 * location. Scoped the same way as listLocationOperatingHours: global
 * readers see everything, location-scoped readers only see rows at their
 * authorised locations.
 */
export async function listEmployeeWorkingHours(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  employeeId: string;
  locationId?: string | null;
}): Promise<
  { ok: true; hours: EmployeeWorkingHours[] } | { ok: false; reason: "forbidden" }
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
  const hasGlobalAccess = hasGlobalReadAccess(scope.ctx.memberships, params.studioId);

  let query = admin
    .from("employee_working_hours")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("employee_id", params.employeeId);

  if (params.locationId) {
    if (!hasGlobalAccess && !scope.accessibleLocationIds.includes(params.locationId)) {
      return { ok: false, reason: "forbidden" };
    }
    query = query.eq("location_id", params.locationId);
  } else if (!hasGlobalAccess) {
    if (scope.accessibleLocationIds.length === 0) return { ok: true, hours: [] };
    query = query.in("location_id", scope.accessibleLocationIds);
  }

  const { data, error } = await query.order("weekday").order("starts_at").returns<EmployeeWorkingHours[]>();
  if (error) throw error;
  return { ok: true, hours: data ?? [] };
}

/**
 * Replace an employee's working-hour intervals at one location for one
 * weekday via the set_employee_working_hours_for_weekday RPC (atomic
 * replace; the database also re-verifies the employee has an active
 * employee_locations assignment for the location). Owner/all-location
 * Manager can target any location; a Location Manager may only target their
 * own authorised location.
 */
export async function setEmployeeWorkingHoursForWeekday(params: {
  userId: string;
  studioId: string;
  employeeId: string;
  locationId: string;
  weekday: number;
  intervals: WorkingHoursInterval[];
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_employee_working_hours_for_weekday", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_employee_id: params.employeeId,
    p_location_id: params.locationId,
    p_weekday: params.weekday,
    p_intervals: params.intervals,
    p_effective_from: params.effectiveFrom ?? null,
    p_effective_until: params.effectiveUntil ?? null,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * Atomic weekly replace wrapper for employee working hours at one location.
 * All submitted weekdays are validated and persisted in one transaction by
 * the set_employee_working_hours_for_week RPC.
 */
export async function setEmployeeWorkingHoursForWeek(params: {
  userId: string;
  studioId: string;
  employeeId: string;
  locationId: string;
  days: WorkingHoursWeekdayInput[];
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...WRITE_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const payload = params.days.map((day) => ({
    weekday: day.weekday,
    intervals: day.intervals,
  }));
  const { error } = await admin.rpc("set_employee_working_hours_for_week", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_employee_id: params.employeeId,
    p_location_id: params.locationId,
    p_days: payload,
    p_effective_from: params.effectiveFrom ?? null,
    p_effective_until: params.effectiveUntil ?? null,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

/**
 * List an employee's availability exceptions. Studio-wide exceptions
 * (location_id null) are visible to every authorised reader, same as
 * HQ-level entries in getServiceLocationAuditTrail; location-scoped readers
 * additionally see only exceptions tied to their authorised locations.
 */
export async function listEmployeeAvailabilityExceptions(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  employeeId: string;
}): Promise<
  { ok: true; exceptions: EmployeeAvailabilityException[] } | { ok: false; reason: "forbidden" }
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
    .from("employee_availability_exceptions")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("employee_id", params.employeeId)
    .order("starts_at", { ascending: false })
    .returns<EmployeeAvailabilityException[]>();
  if (error) throw error;

  const entries = data ?? [];
  if (hasGlobalReadAccess(scope.ctx.memberships, params.studioId)) {
    return { ok: true, exceptions: entries };
  }

  const accessibleLocationIds = new Set(scope.accessibleLocationIds);
  return {
    ok: true,
    exceptions: entries.filter(
      (entry) => entry.location_id == null || accessibleLocationIds.has(entry.location_id),
    ),
  };
}

/**
 * Create a one-off availability exception via the
 * create_employee_availability_exception RPC. A studio-wide exception
 * (locationId omitted) requires Owner/all-location Manager; a location-tied
 * exception may also be created by a Location Manager for their own
 * authorised location.
 */
export async function createEmployeeAvailabilityException(params: {
  userId: string;
  studioId: string;
  employeeId: string;
  exceptionType: ExceptionType;
  reasonCategory: ExceptionReasonCategory;
  startsAt: string;
  endsAt: string;
  locationId?: string | null;
  reason?: string | null;
}): Promise<
  | { ok: true; exceptionId: string }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = params.locationId
    ? await requireStaffScope({
        userId: params.userId,
        studioId: params.studioId,
        locationId: params.locationId,
        roles: [...WRITE_GLOBAL_ROLES],
      })
    : await requireGlobalStaffScope({
        userId: params.userId,
        studioId: params.studioId,
        roles: [...WRITE_GLOBAL_ROLES],
      });
  if (!scope.ok) return scope;

  const admin = createAdminClient();

  if (params.locationId) {
    const { data: assignment, error: assignmentError } = await admin
      .from("employee_locations")
      .select("id")
      .eq("studio_id", params.studioId)
      .eq("employee_id", params.employeeId)
      .eq("location_id", params.locationId)
      .eq("is_active", true)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) {
      return {
        ok: false,
        reason: "invalid_request",
        message: "Employee must have an active assignment at this location.",
      };
    }
  }

  const { data, error } = await admin
    .rpc("create_employee_availability_exception", {
      p_actor_id: params.userId,
      p_actor_role: scope.role,
      p_studio_id: params.studioId,
      p_employee_id: params.employeeId,
      p_exception_type: params.exceptionType,
      p_reason_category: params.reasonCategory,
      p_starts_at: params.startsAt,
      p_ends_at: params.endsAt,
      p_location_id: params.locationId ?? null,
      p_reason: params.reason ?? null,
    })
    .single<{ ok: true; exception_id: string }>();
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true, exceptionId: data.exception_id };
}

/**
 * Delete an availability exception via the
 * delete_employee_availability_exception RPC. Scope is derived from the
 * exception's own location_id (studio-wide requires Owner/all-location
 * Manager; location-tied allows the authorised Location Manager).
 */
export async function deleteEmployeeAvailabilityException(params: {
  userId: string;
  studioId: string;
  exceptionId: string;
}): Promise<
  { ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request" | "not_found"; message?: string }
> {
  const admin = createAdminClient();
  const { data: existing, error: fetchError } = await admin
    .from("employee_availability_exceptions")
    .select("id, location_id")
    .eq("id", params.exceptionId)
    .eq("studio_id", params.studioId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return { ok: false, reason: "not_found" };

  const scope = existing.location_id
    ? await requireStaffScope({
        userId: params.userId,
        studioId: params.studioId,
        locationId: existing.location_id,
        roles: [...WRITE_GLOBAL_ROLES],
      })
    : await requireGlobalStaffScope({
        userId: params.userId,
        studioId: params.studioId,
        roles: [...WRITE_GLOBAL_ROLES],
      });
  if (!scope.ok) return scope;

  const { error } = await admin.rpc("delete_employee_availability_exception", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_exception_id: params.exceptionId,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

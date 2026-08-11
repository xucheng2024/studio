import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { requireGlobalStaffScope, type StaffScopeFailureReason } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export type EmploymentStatus = "active" | "inactive" | "terminated";

export type EmployeeLocation = {
  id: string;
  employee_id: string;
  location_id: string;
  studio_id: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Employee = {
  id: string;
  studio_id: string;
  user_id: string | null;
  instructor_id: string | null;
  employee_number: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  employment_status: EmploymentStatus;
  hired_at: string | null;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeWithLocations = Employee & { employee_locations: EmployeeLocation[] };

const EMPLOYEE_COLUMNS = "*, employee_locations(*)";
const EMPLOYEE_READ_ROLES = ["owner", "manager", "frontdesk"] as const;

function hasGlobalEmployeeReadAccess(
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
 * Fetch one employee within an authorised studio scope: either the employee's
 * own login, or a staff member with access to one of the employee's active
 * working locations. Owners and all-location managers can read every employee.
 */
export async function getEmployeeById(params: {
  userId: string;
  studioId: string;
  employeeId: string;
}): Promise<
  | { ok: true; employee: EmployeeWithLocations }
  | { ok: false; reason: "not_found" | StaffScopeFailureReason }
> {
  const admin = createAdminClient();
  const { data: employee, error } = await admin
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .eq("id", params.employeeId)
    .eq("studio_id", params.studioId)
    .maybeSingle<EmployeeWithLocations>();
  if (error) throw error;
  if (!employee) return { ok: false, reason: "not_found" };

  if (employee.user_id === params.userId) {
    return { ok: true, employee };
  }

  const scope = await getDashboardScopeForRoles(
    { userId: params.userId, studioId: params.studioId },
    [...EMPLOYEE_READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  if (hasGlobalEmployeeReadAccess(scope.ctx.memberships, params.studioId)) {
    return { ok: true, employee };
  }

  const canReadEmployee = employee.employee_locations.some(
    (location) =>
      location.is_active && scope.accessibleLocationIds.includes(location.location_id),
  );
  if (!canReadEmployee) return { ok: false, reason: "forbidden" };

  return { ok: true, employee };
}

/**
 * Resolve the calling user's own Employee identity within a studio, if any.
 * Returns employee: null (not an error) when the user has no employee record yet.
 */
export async function resolveEmployeeForUser(params: {
  userId: string;
  studioId: string;
}): Promise<{ ok: true; employee: EmployeeWithLocations | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .eq("studio_id", params.studioId)
    .eq("user_id", params.userId)
    .maybeSingle<EmployeeWithLocations>();
  if (error) throw error;
  return { ok: true, employee: data ?? null };
}

/**
 * List employees within the caller's authorised studio/location scope.
 * Owners/managers with global location access see all studio employees
 * (including ones with no working location yet); location-scoped staff
 * only see employees with an active assignment to one of their locations.
 */
export async function listEmployeesInScope(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; employees: EmployeeWithLocations[] }
  | { ok: false; reason: "forbidden" }
> {
  const scope = await getDashboardScopeForRoles(
    {
      userId: params.userId,
      email: params.email ?? null,
      studioId: params.studioId,
      locationId: params.locationId ?? null,
    },
    [...EMPLOYEE_READ_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const hasGlobalAccess = hasGlobalEmployeeReadAccess(scope.ctx.memberships, params.studioId);

  if (hasGlobalAccess) {
    const { data, error } = await admin
      .from("employees")
      .select(EMPLOYEE_COLUMNS)
      .eq("studio_id", params.studioId)
      .order("display_name")
      .returns<EmployeeWithLocations[]>();
    if (error) throw error;
    return { ok: true, employees: data ?? [] };
  }

  const accessibleLocationIds = scope.accessibleLocationIds;
  if (accessibleLocationIds.length === 0) {
    return { ok: true, employees: [] };
  }

  const { data: locationRows, error: locationError } = await admin
    .from("employee_locations")
    .select("employee_id")
    .eq("studio_id", params.studioId)
    .eq("is_active", true)
    .in("location_id", accessibleLocationIds);
  if (locationError) throw locationError;

  const employeeIds = [...new Set((locationRows ?? []).map((row) => row.employee_id as string))];
  if (employeeIds.length === 0) return { ok: true, employees: [] };

  const { data, error } = await admin
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .eq("studio_id", params.studioId)
    .in("id", employeeIds)
    .order("display_name")
    .returns<EmployeeWithLocations[]>();
  if (error) throw error;
  return { ok: true, employees: data ?? [] };
}

/**
 * Atomically replace an employee's working locations via the
 * set_employee_working_locations RPC (validates studio match and primary
 * membership server-side, preserves history for removed assignments).
 *
 * Reassigning an employee's working locations can add/remove locations the
 * caller may not themselves be scoped to, so this requires studio-wide
 * (owner or unrestricted "all locations" manager) access rather than any
 * single-location membership — a location-scoped manager cannot use this to
 * reach locations outside their own scope.
 */
export async function setEmployeeWorkingLocations(params: {
  userId: string;
  studioId: string;
  employeeId: string;
  locationIds: string[];
  primaryLocationId: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_employee_working_locations", {
    p_employee_id: params.employeeId,
    p_studio_id: params.studioId,
    p_location_ids: params.locationIds,
    p_primary_location_id: params.primaryLocationId,
  });
  if (error) {
    return { ok: false, reason: "invalid_request", message: error.message };
  }
  return { ok: true };
}

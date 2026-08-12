import "server-only";

import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashIdempotencyRequest,
  type IdempotencyClaimResult,
} from "@/lib/idempotency";
import { buildAccessContext, hasStudioGlobalLocationAccess, type StaffRole } from "@/lib/rbac";
import {
  deriveAllowedSalonCustomerIdsByScopedLocationRole,
  type AppointmentCustomerRelation,
  type ClientLocationRelation,
  type ScopedSensitiveLocationRole,
  type SensitiveActorRole,
} from "@/lib/salon-customer-sensitive-rules";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STAFF_ROLES: StaffRole[] = ["owner", "manager", "frontdesk", "instructor"];

function isUuid(value: string | null | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toUuidArray(input: string | null | undefined) {
  const parsed = (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parsed.length) return [] as string[];
  const valid = parsed.filter((item) => isUuid(item));
  if (valid.length !== parsed.length) {
    return null;
  }
  return valid;
}

function toTextArray(input: string | null | undefined) {
  return (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type SalonCustomerCore = {
  id: string;
  studio_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferred_location_id: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export type SalonCustomerSafetyAlertSummary = {
  hasHealthAlert: boolean;
  hasAllergyAlert: boolean;
  hasContraindicationAlert: boolean;
  patchTestRequired: boolean;
  lastConfirmedAt: string | null;
};

export type SalonCustomerDashboardRow = SalonCustomerCore & {
  safety: SalonCustomerSafetyAlertSummary;
};

export type SalonCustomerPreferenceProfile = {
  id: string;
  preferred_services: string | null;
  preferred_employee_ids: string[];
  preferred_location_ids: string[];
  preferred_time_slots: string[];
  communication_language: string | null;
  product_preferences: string | null;
  environment_preferences: string | null;
  contact_preference: string | null;
  notes: string | null;
  updated_at: string;
};

export type SalonCustomerHealthProfile = {
  id: string;
  allergies: string | null;
  reaction_ingredients: string | null;
  reaction_products: string | null;
  declared_health_conditions: string | null;
  service_affecting_conditions: string | null;
  contraindications: string | null;
  patch_test_required: boolean;
  patch_test_date: string | null;
  patch_test_result: string | null;
  last_confirmed_at: string | null;
  recorded_by: string;
  updated_by: string;
  updated_at: string;
};

type HealthSummaryRow = {
  salon_customer_id: string;
  allergies: string | null;
  declared_health_conditions: string | null;
  service_affecting_conditions: string | null;
  contraindications: string | null;
  patch_test_required: boolean;
  last_confirmed_at: string | null;
};

export type SalonCustomerConsentEvent = {
  id: string;
  status: "granted" | "withdrawn";
  source: string;
  text_version: string;
  occurred_at: string;
  actor_id: string;
  actor_role: string;
  created_at: string;
};

export type SalonCustomerAccessAuditEntry = {
  id: string;
  action: string;
  actor_id: string;
  actor_role: string;
  location_id: string | null;
  reason: string | null;
  created_at: string;
};

export type SensitiveCustomerDetail = {
  customer: SalonCustomerCore;
  safety: SalonCustomerSafetyAlertSummary;
  preferences: SalonCustomerPreferenceProfile | null;
  health: SalonCustomerHealthProfile | null;
  consents: SalonCustomerConsentEvent[];
  accessAudits: SalonCustomerAccessAuditEntry[];
  canViewSensitiveAudit: boolean;
};

type ResolvedSensitiveAccess = {
  role: SensitiveActorRole;
  userId: string;
  studioId: string;
  resolvedLocationId: string | null;
  allowedLocationIds: string[];
  hasGlobalStudioScope: boolean;
  actorEmployeeIds: string[];
  customer: SalonCustomerCore;
};

function resolveStudioActorRole(
  memberships: Array<{ role: StaffRole; location_id: string | null }>,
): SensitiveActorRole {
  if (memberships.some((membership) => membership.role === "owner")) return "owner";
  if (memberships.some((membership) => membership.role === "manager")) return "manager";
  if (memberships.some((membership) => membership.role === "frontdesk")) return "frontdesk";
  return "instructor";
}

function hasStudioGlobalSensitiveAccess(
  memberships: Array<{ role: StaffRole; location_id: string | null }>,
) {
  return memberships.some(
    (membership) => membership.location_id == null && (membership.role === "owner" || membership.role === "manager"),
  );
}

function roleRank(role: SensitiveActorRole) {
  if (role === "owner") return 4;
  if (role === "manager") return 3;
  if (role === "frontdesk") return 2;
  return 1;
}

function pickHigherRole(current: SensitiveActorRole | null, candidate: SensitiveActorRole | null) {
  if (!candidate) return current;
  if (!current) return candidate;
  return roleRank(candidate) > roleRank(current) ? candidate : current;
}

function normalizeStaffRole(role: StaffRole): SensitiveActorRole {
  if (role === "owner") return "owner";
  if (role === "manager") return "manager";
  if (role === "frontdesk") return "frontdesk";
  return "instructor";
}

function buildScopedLocationActorRoleMap(params: {
  memberships: Array<{ role: StaffRole; location_id: string | null }>;
  locationIds: string[];
}) {
  let globalRole: SensitiveActorRole | null = null;
  const localRoleById = new Map<string, SensitiveActorRole>();

  for (const membership of params.memberships) {
    const normalizedRole = normalizeStaffRole(membership.role);
    if (!membership.location_id) {
      globalRole = pickHigherRole(globalRole, normalizedRole);
      continue;
    }
    const localRole = pickHigherRole(localRoleById.get(membership.location_id) ?? null, normalizedRole);
    if (localRole) {
      localRoleById.set(membership.location_id, localRole);
    }
  }

  const locationRoleById: Record<string, SensitiveActorRole> = {};
  for (const locationId of params.locationIds) {
    const scopedRole = pickHigherRole(globalRole, localRoleById.get(locationId) ?? null);
    if (scopedRole) {
      locationRoleById[locationId] = scopedRole;
    }
  }

  const nonInstructorLocationIds = Object.entries(locationRoleById)
    .filter(([, role]) => role !== "instructor")
    .map(([locationId]) => locationId);

  return { locationRoleById, nonInstructorLocationIds };
}

function buildScopedLocationRoleMap(params: {
  memberships: Array<{ role: StaffRole; location_id: string | null }>;
  locationIds: string[];
}) {
  const scopedActorRoles = buildScopedLocationActorRoleMap(params).locationRoleById;
  const locationRoleById: Record<string, ScopedSensitiveLocationRole> = {};
  for (const [locationId, role] of Object.entries(scopedActorRoles)) {
    locationRoleById[locationId] = role === "instructor" ? "instructor" : "non_instructor";
  }
  const nonInstructorLocationIds = Object.keys(locationRoleById).filter((locationId) => locationRoleById[locationId] === "non_instructor");
  return { locationRoleById, nonInstructorLocationIds };
}

async function resolveAllowedCustomerIdsByRelationship(params: {
  studioId: string;
  memberships: Array<{ role: StaffRole; location_id: string | null }>;
  locationIds: string[];
  actorEmployeeIds: string[];
  customerRows: Array<Pick<SalonCustomerCore, "id" | "user_id">>;
}) {
  if (!params.customerRows.length || !params.locationIds.length) {
    return new Set<string>();
  }

  const { locationRoleById, nonInstructorLocationIds } = buildScopedLocationRoleMap({
    memberships: params.memberships,
    locationIds: params.locationIds,
  });
  if (!Object.keys(locationRoleById).length) {
    return new Set<string>();
  }

  const admin = createAdminClient();
  const actorEmployeeIdSet = new Set(params.actorEmployeeIds);
  const relatedAppointmentsQuery = admin
    .from("salon_appointments")
    .select("salon_customer_id, location_id, employee_id")
    .eq("studio_id", params.studioId)
    .in("location_id", params.locationIds)
    .in("salon_customer_id", params.customerRows.map((row) => row.id));

  const appointmentRows = await relatedAppointmentsQuery;
  if (appointmentRows.error) throw appointmentRows.error;
  const appointmentRelations: AppointmentCustomerRelation[] = (appointmentRows.data ?? [])
    .filter((row): row is { salon_customer_id: string; location_id: string; employee_id: string | null } =>
      Boolean(row.salon_customer_id && row.location_id),
    )
    .map((row) => ({
      salon_customer_id: row.salon_customer_id,
      location_id: row.location_id,
      served_by_actor: Boolean(row.employee_id && actorEmployeeIdSet.has(row.employee_id)),
    }));

  const customerUserIds = params.customerRows
    .map((row) => row.user_id)
    .filter((userId): userId is string => Boolean(userId));

  if (!customerUserIds.length) {
    return deriveAllowedSalonCustomerIdsByScopedLocationRole({
      customerRows: params.customerRows,
      locationRoleById,
      appointmentRelations,
      paymentRelations: [],
      bookingRelations: [],
    });
  }

  if (!nonInstructorLocationIds.length) {
    return deriveAllowedSalonCustomerIdsByScopedLocationRole({
      customerRows: params.customerRows,
      locationRoleById,
      appointmentRelations,
      paymentRelations: [],
      bookingRelations: [],
    });
  }

  const [paymentRowsRes, bookingRowsRes] = await Promise.all([
    admin
      .from("payments")
      .select("client_id, location_id")
      .eq("studio_id", params.studioId)
      .in("location_id", nonInstructorLocationIds)
      .in("client_id", customerUserIds),
    admin
      .from("bookings")
      .select("client_id, class_sessions!inner(location_id, classes!inner(studio_id))")
      .in("client_id", customerUserIds)
      .in("class_sessions.location_id", nonInstructorLocationIds)
      .eq("class_sessions.classes.studio_id", params.studioId),
  ]);
  if (paymentRowsRes.error) throw paymentRowsRes.error;
  if (bookingRowsRes.error) throw bookingRowsRes.error;

  const paymentRelations: ClientLocationRelation[] = (paymentRowsRes.data ?? [])
    .filter((row): row is { client_id: string; location_id: string } => Boolean(row.client_id && row.location_id))
    .map((row) => ({ client_id: row.client_id, location_id: row.location_id }));
  const bookingRelations: ClientLocationRelation[] = (bookingRowsRes.data ?? [])
    .map((row) => {
      const classSession = Array.isArray(row.class_sessions) ? row.class_sessions[0] : row.class_sessions;
      return {
        client_id: row.client_id,
        location_id: classSession?.location_id,
      };
    })
    .filter((row): row is { client_id: string; location_id: string } => Boolean(row.client_id && row.location_id));

  return deriveAllowedSalonCustomerIdsByScopedLocationRole({
    customerRows: params.customerRows,
    locationRoleById,
    appointmentRelations,
    paymentRelations,
    bookingRelations,
  });
}

async function resolveCustomerRelationshipGrant(params: {
  studioId: string;
  memberships: Array<{ role: StaffRole; location_id: string | null }>;
  locationIds: string[];
  actorEmployeeIds: string[];
  customer: Pick<SalonCustomerCore, "id" | "user_id">;
  preferredLocationId?: string | null;
}): Promise<{ role: SensitiveActorRole; locationId: string } | null> {
  if (!params.locationIds.length) {
    return null;
  }

  const { locationRoleById, nonInstructorLocationIds } = buildScopedLocationActorRoleMap({
    memberships: params.memberships,
    locationIds: params.locationIds,
  });
  if (!Object.keys(locationRoleById).length) {
    return null;
  }

  const admin = createAdminClient();
  const actorEmployeeIdSet = new Set(params.actorEmployeeIds);
  const candidates: Array<{ role: SensitiveActorRole; locationId: string; reason: "appointment" | "payment" | "booking" }> = [];

  const appointmentsRes = await admin
    .from("salon_appointments")
    .select("location_id, employee_id")
    .eq("studio_id", params.studioId)
    .eq("salon_customer_id", params.customer.id)
    .in("location_id", params.locationIds);
  if (appointmentsRes.error) throw appointmentsRes.error;

  for (const row of appointmentsRes.data ?? []) {
    if (!row.location_id) continue;
    const scopedRole = locationRoleById[row.location_id];
    if (!scopedRole) continue;
    if (scopedRole !== "instructor") {
      candidates.push({ role: scopedRole, locationId: row.location_id, reason: "appointment" });
      continue;
    }
    if (row.employee_id && actorEmployeeIdSet.has(row.employee_id)) {
      candidates.push({ role: "instructor", locationId: row.location_id, reason: "appointment" });
    }
  }

  if (params.customer.user_id && nonInstructorLocationIds.length) {
    const [paymentsRes, bookingsRes] = await Promise.all([
      admin
        .from("payments")
        .select("location_id")
        .eq("studio_id", params.studioId)
        .eq("client_id", params.customer.user_id)
        .in("location_id", nonInstructorLocationIds),
      admin
        .from("bookings")
        .select("class_sessions!inner(location_id, classes!inner(studio_id))")
        .eq("client_id", params.customer.user_id)
        .in("class_sessions.location_id", nonInstructorLocationIds)
        .eq("class_sessions.classes.studio_id", params.studioId),
    ]);
    if (paymentsRes.error) throw paymentsRes.error;
    if (bookingsRes.error) throw bookingsRes.error;

    for (const row of paymentsRes.data ?? []) {
      if (!row.location_id) continue;
      const scopedRole = locationRoleById[row.location_id];
      if (!scopedRole || scopedRole === "instructor") continue;
      candidates.push({ role: scopedRole, locationId: row.location_id, reason: "payment" });
    }

    for (const row of bookingsRes.data ?? []) {
      const classSession = Array.isArray(row.class_sessions) ? row.class_sessions[0] : row.class_sessions;
      const locationId = classSession?.location_id;
      if (!locationId) continue;
      const scopedRole = locationRoleById[locationId];
      if (!scopedRole || scopedRole === "instructor") continue;
      candidates.push({ role: scopedRole, locationId, reason: "booking" });
    }
  }

  if (!candidates.length) {
    return null;
  }

  if (params.preferredLocationId) {
    const preferredCandidate = candidates.find((candidate) => candidate.locationId === params.preferredLocationId);
    if (preferredCandidate) {
      return { role: preferredCandidate.role, locationId: preferredCandidate.locationId };
    }
  }

  candidates.sort((left, right) => {
    if (left.reason !== right.reason) {
      const reasonRank = { appointment: 0, booking: 1, payment: 2 } as const;
      return reasonRank[left.reason] - reasonRank[right.reason];
    }
    return roleRank(right.role) - roleRank(left.role);
  });

  return { role: candidates[0].role, locationId: candidates[0].locationId };
}

async function resolveSensitiveCustomerAccess(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  customerId: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; access: ResolvedSensitiveAccess }
  | { ok: false; reason: "forbidden" | "not_found" | "invalid_request"; message?: string }
> {
  if (!isUuid(params.userId) || !isUuid(params.studioId) || !isUuid(params.customerId)) {
    return { ok: false, reason: "invalid_request", message: "invalid_uuid" };
  }
  if (params.locationId && !isUuid(params.locationId)) {
    return { ok: false, reason: "invalid_request", message: "invalid_location_uuid" };
  }

  const admin = createAdminClient();
  const { data: customer, error: customerError } = await admin
    .from("salon_customers")
    .select("id, studio_id, user_id, full_name, email, phone, preferred_location_id, status, source, created_at, updated_at")
    .eq("id", params.customerId)
    .eq("studio_id", params.studioId)
    .is("merged_into_id", null)
    .maybeSingle<SalonCustomerCore>();
  if (customerError) throw customerError;
  if (!customer) return { ok: false, reason: "not_found" };

  const ctx = await buildAccessContext(params.userId, params.email ?? null, params.locationId ?? null);
  const scopedMemberships = ctx.memberships.filter(
    (membership) => membership.studio_id === params.studioId && STAFF_ROLES.includes(membership.role),
  );
  if (!scopedMemberships.length) {
    return { ok: false, reason: "forbidden" };
  }

  let role = resolveStudioActorRole(scopedMemberships);
  let resolvedLocationId: string | null = params.locationId ?? null;
  const hasGlobalStudioScope = hasStudioGlobalLocationAccess(ctx, params.studioId)
    && hasStudioGlobalSensitiveAccess(scopedMemberships);
  const allowedLocationIds = ctx.locations
    .filter((location) => location.studio_id === params.studioId)
    .map((location) => location.id);

  let actorEmployeeIds: string[] = [];
  if (scopedMemberships.some((membership) => membership.role === "instructor")) {
    const { data: actorEmployees } = await admin
      .from("employees")
      .select("id")
      .eq("studio_id", params.studioId)
      .eq("user_id", params.userId)
      .eq("is_active", true);
    actorEmployeeIds = (actorEmployees ?? []).map((row) => row.id);
  }

  if (!hasGlobalStudioScope) {
    if (!allowedLocationIds.length) {
      return { ok: false, reason: "forbidden" };
    }

    const grant = await resolveCustomerRelationshipGrant({
      studioId: params.studioId,
      memberships: scopedMemberships,
      locationIds: allowedLocationIds,
      actorEmployeeIds,
      customer,
      preferredLocationId: params.locationId ?? null,
    });
    if (!grant) {
      return { ok: false, reason: "forbidden" };
    }
    role = grant.role;
    resolvedLocationId = grant.locationId;
  }

  return {
    ok: true,
    access: {
      role,
      userId: params.userId,
      studioId: params.studioId,
      resolvedLocationId,
      allowedLocationIds,
      hasGlobalStudioScope,
      actorEmployeeIds,
      customer,
    },
  };
}

function healthToSafetySummary(
  health: Pick<
    SalonCustomerHealthProfile,
    "allergies" | "declared_health_conditions" | "service_affecting_conditions" | "contraindications" | "patch_test_required" | "last_confirmed_at"
  > | null,
): SalonCustomerSafetyAlertSummary {
  const hasAllergyAlert = Boolean(normalizeText(health?.allergies));
  const hasHealthConditionAlert = Boolean(
    normalizeText(health?.declared_health_conditions) || normalizeText(health?.service_affecting_conditions),
  );
  const hasContraindicationAlert = Boolean(normalizeText(health?.contraindications));

  return {
    hasHealthAlert: hasAllergyAlert || hasHealthConditionAlert || hasContraindicationAlert || Boolean(health?.patch_test_required),
    hasAllergyAlert,
    hasContraindicationAlert,
    patchTestRequired: Boolean(health?.patch_test_required),
    lastConfirmedAt: health?.last_confirmed_at ?? null,
  };
}

async function recordSensitiveAccessAudit(params: {
  studioId: string;
  customerId: string;
  actorId: string;
  actorRole: SensitiveActorRole;
  action: "preference_view" | "health_view" | "consent_view" | "safety_summary_view";
  locationId?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_salon_customer_access_audit", {
    p_studio_id: params.studioId,
    p_salon_customer_id: params.customerId,
    p_actor_id: params.actorId,
    p_actor_role: params.actorRole,
    p_action: params.action,
    p_location_id: params.locationId ?? null,
    p_reason: null,
    p_metadata: {},
  });
  if (error) throw error;
}

export async function listSalonCustomersForDashboard(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
}): Promise<{ ok: true; customers: SalonCustomerDashboardRow[] } | { ok: false; reason: "forbidden" | "invalid_request" }> {
  if (!isUuid(params.userId) || !isUuid(params.studioId)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (params.locationId && !isUuid(params.locationId)) {
    return { ok: false, reason: "invalid_request" };
  }

  const ctx = await buildAccessContext(params.userId, params.email ?? null, params.locationId ?? null);
  const studioMemberships = ctx.memberships.filter(
    (membership) => membership.studio_id === params.studioId && STAFF_ROLES.includes(membership.role),
  );
  if (!studioMemberships.length) return { ok: false, reason: "forbidden" };

  const admin = createAdminClient();
  const hasGlobalScope = hasStudioGlobalLocationAccess(ctx, params.studioId)
    && hasStudioGlobalSensitiveAccess(studioMemberships);
  const locationIds = ctx.locations
    .filter((location) => location.studio_id === params.studioId)
    .map((location) => location.id);

  const { data: baseRows, error: baseError } = await admin
    .from("salon_customers")
    .select("id, studio_id, user_id, full_name, email, phone, preferred_location_id, status, source, created_at, updated_at")
    .eq("studio_id", params.studioId)
    .is("merged_into_id", null)
    .order("full_name")
    .returns<SalonCustomerCore[]>();
  if (baseError) throw baseError;

  const customerRows = baseRows ?? [];
  if (!customerRows.length) return { ok: true, customers: [] };

  let allowedCustomerIds = new Set(customerRows.map((row) => row.id));

  if (!hasGlobalScope) {
    if (!locationIds.length) {
      return { ok: true, customers: [] };
    }

    let actorEmployeeIds: string[] = [];
    if (studioMemberships.some((membership) => membership.role === "instructor")) {
      const { data: actorEmployees } = await admin
        .from("employees")
        .select("id")
        .eq("studio_id", params.studioId)
        .eq("user_id", params.userId)
        .eq("is_active", true);
      actorEmployeeIds = (actorEmployees ?? []).map((row) => row.id);
    }

    allowedCustomerIds = await resolveAllowedCustomerIdsByRelationship({
      studioId: params.studioId,
      memberships: studioMemberships,
      locationIds,
      actorEmployeeIds,
      customerRows,
    });
  }

  const scopedCustomers = customerRows.filter((row) => allowedCustomerIds.has(row.id));
  if (!scopedCustomers.length) return { ok: true, customers: [] };

  const { data: healthRows, error: healthError } = await admin
    .from("salon_customer_health_profiles")
    .select("salon_customer_id, allergies, declared_health_conditions, service_affecting_conditions, contraindications, patch_test_required, last_confirmed_at")
    .eq("studio_id", params.studioId)
    .in("salon_customer_id", scopedCustomers.map((row) => row.id));
  if (healthError) throw healthError;

  const healthByCustomer = new Map<string, HealthSummaryRow>();
  for (const row of healthRows ?? []) {
    healthByCustomer.set(row.salon_customer_id, row as HealthSummaryRow);
  }

  return {
    ok: true,
    customers: scopedCustomers.map((customer) => ({
      ...customer,
      safety: healthToSafetySummary(healthByCustomer.get(customer.id) ?? null),
    })),
  };
}

export async function getSalonCustomerSafetyAlertSummary(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  customerId: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; summary: SalonCustomerSafetyAlertSummary }
  | { ok: false; reason: "forbidden" | "not_found" | "invalid_request" }
> {
  const access = await resolveSensitiveCustomerAccess(params);
  if (!access.ok) return access;
  const effectiveLocationId = params.locationId ?? access.access.resolvedLocationId;

  const admin = createAdminClient();
  const { data: health, error } = await admin
    .from("salon_customer_health_profiles")
    .select("id, allergies, reaction_ingredients, reaction_products, declared_health_conditions, service_affecting_conditions, contraindications, patch_test_required, patch_test_date, patch_test_result, last_confirmed_at, recorded_by, updated_by, updated_at")
    .eq("studio_id", params.studioId)
    .eq("salon_customer_id", params.customerId)
    .maybeSingle<SalonCustomerHealthProfile>();
  if (error) throw error;

  await recordSensitiveAccessAudit({
    studioId: params.studioId,
    customerId: params.customerId,
    actorId: params.userId,
    actorRole: access.access.role,
    action: "safety_summary_view",
    locationId: effectiveLocationId,
  });

  return { ok: true, summary: healthToSafetySummary(health ?? null) };
}

export async function getSalonCustomerSensitiveDetail(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  customerId: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; detail: SensitiveCustomerDetail }
  | { ok: false; reason: "forbidden" | "not_found" | "invalid_request" }
> {
  const access = await resolveSensitiveCustomerAccess(params);
  if (!access.ok) return access;
  const effectiveLocationId = params.locationId ?? access.access.resolvedLocationId;

  const admin = createAdminClient();
  const [preferencesRes, healthRes, consentsRes] = await Promise.all([
    admin
      .from("salon_customer_preferences")
      .select("id, preferred_services, preferred_employee_ids, preferred_location_ids, preferred_time_slots, communication_language, product_preferences, environment_preferences, contact_preference, notes, updated_at")
      .eq("studio_id", params.studioId)
      .eq("salon_customer_id", params.customerId)
      .maybeSingle<SalonCustomerPreferenceProfile>(),
    admin
      .from("salon_customer_health_profiles")
      .select("id, allergies, reaction_ingredients, reaction_products, declared_health_conditions, service_affecting_conditions, contraindications, patch_test_required, patch_test_date, patch_test_result, last_confirmed_at, recorded_by, updated_by, updated_at")
      .eq("studio_id", params.studioId)
      .eq("salon_customer_id", params.customerId)
      .maybeSingle<SalonCustomerHealthProfile>(),
    admin
      .from("salon_customer_consents")
      .select("id, status, source, text_version, occurred_at, actor_id, actor_role, created_at")
      .eq("studio_id", params.studioId)
      .eq("salon_customer_id", params.customerId)
      .eq("consent_key", "email_marketing")
      .eq("channel", "email")
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<SalonCustomerConsentEvent[]>(),
  ]);

  if (preferencesRes.error) throw preferencesRes.error;
  if (healthRes.error) throw healthRes.error;
  if (consentsRes.error) throw consentsRes.error;

  const canViewSensitiveAudit = access.access.hasGlobalStudioScope && (access.access.role === "owner" || access.access.role === "manager");
  let accessAudits: SalonCustomerAccessAuditEntry[] = [];

  if (canViewSensitiveAudit) {
    const auditsRes = await admin
      .from("salon_customer_access_audits")
      .select("id, action, actor_id, actor_role, location_id, reason, created_at")
      .eq("studio_id", params.studioId)
      .eq("salon_customer_id", params.customerId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<SalonCustomerAccessAuditEntry[]>();
    if (auditsRes.error) throw auditsRes.error;
    accessAudits = auditsRes.data ?? [];
  }

  await recordSensitiveAccessAudit({
    studioId: params.studioId,
    customerId: params.customerId,
    actorId: params.userId,
    actorRole: access.access.role,
    action: "preference_view",
    locationId: effectiveLocationId,
  });

  await recordSensitiveAccessAudit({
    studioId: params.studioId,
    customerId: params.customerId,
    actorId: params.userId,
    actorRole: access.access.role,
    action: "health_view",
    locationId: effectiveLocationId,
  });

  await recordSensitiveAccessAudit({
    studioId: params.studioId,
    customerId: params.customerId,
    actorId: params.userId,
    actorRole: access.access.role,
    action: "consent_view",
    locationId: effectiveLocationId,
  });

  return {
    ok: true,
    detail: {
      customer: access.access.customer,
      safety: healthToSafetySummary(healthRes.data ?? null),
      preferences: preferencesRes.data,
      health: healthRes.data,
      consents: consentsRes.data ?? [],
      accessAudits,
      canViewSensitiveAudit,
    },
  };
}

export async function updateSalonCustomerPreferences(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  customerId: string;
  locationId?: string | null;
  reason?: string | null;
  input: {
    preferredServices?: string | null;
    preferredEmployeeIds?: string | null;
    preferredLocationIds?: string | null;
    preferredTimeSlots?: string | null;
    communicationLanguage?: string | null;
    productPreferences?: string | null;
    environmentPreferences?: string | null;
    contactPreference?: string | null;
    notes?: string | null;
  };
}): Promise<{ ok: true } | { ok: false; reason: "forbidden" | "not_found" | "invalid_request"; message?: string }> {
  const access = await resolveSensitiveCustomerAccess(params);
  if (!access.ok) return access;
  const effectiveLocationId = params.locationId ?? access.access.resolvedLocationId;

  const preferredEmployeeIds = toUuidArray(params.input.preferredEmployeeIds ?? null);
  const preferredLocationIds = toUuidArray(params.input.preferredLocationIds ?? null);
  if (preferredEmployeeIds === null || preferredLocationIds === null) {
    return { ok: false, reason: "invalid_request", message: "invalid_uuid_list" };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("upsert_salon_customer_preferences", {
    p_studio_id: params.studioId,
    p_salon_customer_id: params.customerId,
    p_actor_id: params.userId,
    p_actor_role: access.access.role,
    p_preferred_services: normalizeText(params.input.preferredServices),
    p_preferred_employee_ids: preferredEmployeeIds,
    p_preferred_location_ids: preferredLocationIds,
    p_preferred_time_slots: toTextArray(params.input.preferredTimeSlots),
    p_communication_language: normalizeText(params.input.communicationLanguage),
    p_product_preferences: normalizeText(params.input.productPreferences),
    p_environment_preferences: normalizeText(params.input.environmentPreferences),
    p_contact_preference: normalizeText(params.input.contactPreference),
    p_notes: normalizeText(params.input.notes),
    p_reason: normalizeText(params.reason),
    p_location_id: effectiveLocationId,
  });

  if (error) {
    return { ok: false, reason: "invalid_request", message: error.message };
  }

  return { ok: true };
}

export async function updateSalonCustomerHealthProfile(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  customerId: string;
  locationId?: string | null;
  reason?: string | null;
  input: {
    allergies?: string | null;
    reactionIngredients?: string | null;
    reactionProducts?: string | null;
    declaredHealthConditions?: string | null;
    serviceAffectingConditions?: string | null;
    contraindications?: string | null;
    patchTestRequired?: boolean;
    patchTestDate?: string | null;
    patchTestResult?: string | null;
    lastConfirmedAt?: string | null;
  };
}): Promise<{ ok: true } | { ok: false; reason: "forbidden" | "not_found" | "invalid_request"; message?: string }> {
  const access = await resolveSensitiveCustomerAccess(params);
  if (!access.ok) return access;
  const effectiveLocationId = params.locationId ?? access.access.resolvedLocationId;

  const patchTestDate = normalizeText(params.input.patchTestDate);
  const lastConfirmedAt = normalizeText(params.input.lastConfirmedAt);

  if (patchTestDate && Number.isNaN(new Date(patchTestDate).getTime())) {
    return { ok: false, reason: "invalid_request", message: "invalid_patch_test_date" };
  }
  if (lastConfirmedAt && Number.isNaN(new Date(lastConfirmedAt).getTime())) {
    return { ok: false, reason: "invalid_request", message: "invalid_last_confirmed_at" };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("upsert_salon_customer_health_profile", {
    p_studio_id: params.studioId,
    p_salon_customer_id: params.customerId,
    p_actor_id: params.userId,
    p_actor_role: access.access.role,
    p_allergies: normalizeText(params.input.allergies),
    p_reaction_ingredients: normalizeText(params.input.reactionIngredients),
    p_reaction_products: normalizeText(params.input.reactionProducts),
    p_declared_health_conditions: normalizeText(params.input.declaredHealthConditions),
    p_service_affecting_conditions: normalizeText(params.input.serviceAffectingConditions),
    p_contraindications: normalizeText(params.input.contraindications),
    p_patch_test_required: Boolean(params.input.patchTestRequired),
    p_patch_test_date: patchTestDate,
    p_patch_test_result: normalizeText(params.input.patchTestResult),
    p_last_confirmed_at: lastConfirmedAt,
    p_reason: normalizeText(params.reason),
    p_location_id: effectiveLocationId,
  });

  if (error) {
    return { ok: false, reason: "invalid_request", message: error.message };
  }

  return { ok: true };
}

type ConsentMutationResult =
  | { ok: true; eventId: string; effectiveStatus: "granted" | "withdrawn" }
  | { ok: false; code: "forbidden" | "not_found" | "invalid_request" | "idempotency_conflict" | "idempotency_in_progress" | "idempotency_permanently_failed" | "idempotency_stale_claim"; message: string };

type ConsentMutationErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "idempotency_permanently_failed"
  | "idempotency_stale_claim";

async function recoverConsentSnapshotFromClaim(params: {
  studioId: string;
  customerId: string;
  claimId: string;
  claimToken: string;
}) {
  const admin = createAdminClient();
  const { data: existingEvent, error: existingEventError } = await admin
    .from("salon_customer_consents")
    .select("id")
    .eq("idempotency_key_id", params.claimId)
    .maybeSingle<{ id: string }>();
  if (existingEventError) throw existingEventError;
  if (!existingEvent) return null;

  const { data: latestEvent, error: latestEventError } = await admin
    .from("salon_customer_consents")
    .select("status")
    .eq("studio_id", params.studioId)
    .eq("salon_customer_id", params.customerId)
    .eq("consent_key", "email_marketing")
    .eq("channel", "email")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ status: "granted" | "withdrawn" }>();
  if (latestEventError) throw latestEventError;
  if (!latestEvent?.status) return null;

  const completed = await completeIdempotencyKey({
    recordId: params.claimId,
    claimToken: params.claimToken,
    resultSnapshot: {
      eventId: existingEvent.id,
      effectiveStatus: latestEvent.status,
    },
  });
  if (!completed.ok) {
    return { staleClaim: true as const };
  }

  return {
    staleClaim: false as const,
    eventId: existingEvent.id,
    effectiveStatus: latestEvent.status,
  };
}

function parseConsentIdempotencyClaim(claim: IdempotencyClaimResult):
  | { ok: true; mode: "claimed"; claimId: string; claimToken: string }
  | { ok: true; mode: "completed"; payload: { eventId: string; effectiveStatus: "granted" | "withdrawn" } }
  | { ok: false; code: ConsentMutationErrorCode; message: string } {
  if (claim.ok && claim.outcome === "claimed") {
    return { ok: true, mode: "claimed", claimId: claim.id, claimToken: claim.claimToken };
  }
  if (claim.ok && claim.outcome === "already_completed") {
    const payload = claim.result as { eventId?: string; effectiveStatus?: "granted" | "withdrawn" } | null;
    if (!payload?.eventId || !payload?.effectiveStatus) {
      return { ok: false, code: "invalid_request", message: "Stored idempotency result is malformed." };
    }
    return {
      ok: true,
      mode: "completed",
      payload: {
        eventId: payload.eventId,
        effectiveStatus: payload.effectiveStatus,
      },
    };
  }
  if (claim.ok && claim.outcome === "in_progress") {
    return { ok: false, code: "idempotency_in_progress", message: "Another request with the same idempotency key is still in progress." };
  }
  if (!claim.ok && claim.outcome === "hash_conflict") {
    return { ok: false, code: "idempotency_conflict", message: "Idempotency key was reused with different payload." };
  }
  return { ok: false, code: "idempotency_permanently_failed", message: "This idempotency key has a permanent failure state." };
}

export async function mutateSalonCustomerEmailConsent(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  customerId: string;
  locationId?: string | null;
  idempotencyKey: string;
  input: {
    status: "granted" | "withdrawn";
    source: "frontdesk" | "client_portal" | "imported" | "system" | "api";
    textVersion: string;
    occurredAt?: string | null;
    evidence?: Record<string, unknown>;
  };
}): Promise<ConsentMutationResult> {
  const access = await resolveSensitiveCustomerAccess(params);
  if (!access.ok) {
    return { ok: false, code: access.reason === "not_found" ? "not_found" : access.reason, message: access.reason };
  }
  const effectiveLocationId = params.locationId ?? access.access.resolvedLocationId;

  if (!params.idempotencyKey.trim()) {
    return { ok: false, code: "invalid_request", message: "idempotency_key_required" };
  }

  const requestPayload = {
    customerId: params.customerId,
    status: params.input.status,
    source: params.input.source,
    textVersion: params.input.textVersion,
    occurredAt: params.input.occurredAt ?? null,
    evidence: params.input.evidence ?? {},
  };

  const claim = await claimIdempotencyKey({
    studioId: params.studioId,
    operationScope: "salon_customer_consent:email",
    idempotencyKey: params.idempotencyKey,
    requestHash: hashIdempotencyRequest(requestPayload),
  });

  const parsed = parseConsentIdempotencyClaim(claim);
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, message: parsed.message };
  }

  if (parsed.mode === "completed") {
    return { ok: true, eventId: parsed.payload.eventId, effectiveStatus: parsed.payload.effectiveStatus };
  }

  const recovered = await recoverConsentSnapshotFromClaim({
    studioId: params.studioId,
    customerId: params.customerId,
    claimId: parsed.claimId,
    claimToken: parsed.claimToken,
  });
  if (recovered) {
    if (recovered.staleClaim) {
      return {
        ok: false,
        code: "idempotency_stale_claim",
        message: "Idempotency claim token is stale.",
      };
    }
    return {
      ok: true,
      eventId: recovered.eventId,
      effectiveStatus: recovered.effectiveStatus,
    };
  }

  const admin = createAdminClient();

  try {
    const { data, error } = await admin.rpc("record_salon_customer_email_consent_idempotent", {
      p_studio_id: params.studioId,
      p_salon_customer_id: params.customerId,
      p_actor_id: params.userId,
      p_actor_role: access.access.role,
      p_status: params.input.status,
      p_source: params.input.source,
      p_text_version: params.input.textVersion,
      p_evidence: params.input.evidence ?? {},
      p_occurred_at: params.input.occurredAt ?? null,
      p_location_id: effectiveLocationId,
      p_correlation_id: null,
      p_idempotency_key_id: parsed.claimId,
      p_idempotency_claim_token: parsed.claimToken,
    });

    if (error) {
      const failed = await failIdempotencyKey({
        recordId: parsed.claimId,
        claimToken: parsed.claimToken,
        errorSummary: error.message,
      });
      if (!failed.ok) {
        return {
          ok: false,
          code: "idempotency_stale_claim",
          message: "Idempotency claim token is stale.",
        };
      }
      return { ok: false, code: "invalid_request", message: error.message };
    }

    const response = data as { ok?: boolean; reason?: string; eventId?: string; effectiveStatus?: "granted" | "withdrawn" };
    if (!response.ok || !response.eventId || !response.effectiveStatus) {
      const failed = await failIdempotencyKey({
        recordId: parsed.claimId,
        claimToken: parsed.claimToken,
        errorSummary: response.reason ?? "consent_mutation_failed",
      });
      if (!failed.ok) {
        return {
          ok: false,
          code: "idempotency_stale_claim",
          message: "Idempotency claim token is stale.",
        };
      }
      return { ok: false, code: "invalid_request", message: response.reason ?? "consent_mutation_failed" };
    }

    return {
      ok: true,
      eventId: response.eventId,
      effectiveStatus: response.effectiveStatus,
    };
  } catch (error) {
    await failIdempotencyKey({
      recordId: parsed.claimId,
      claimToken: parsed.claimToken,
      errorSummary: error instanceof Error ? error.message : "unknown_consent_error",
    });
    throw error;
  }
}

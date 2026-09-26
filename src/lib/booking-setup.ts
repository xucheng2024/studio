import "server-only";

import { createHash } from "node:crypto";
import { setEmployeeWorkingLocations } from "@/lib/employees";
import { requireGlobalStaffScope, type StaffScopeFailureReason } from "@/lib/scope";
import { setServiceEmployeeEligibilities } from "@/lib/service-availability";
import { setServicePublishScope } from "@/lib/service-locations";
import { setEmployeeWorkingHoursForWeek, setLocationOperatingHoursForWeek } from "@/lib/staff-availability";
import { getLatestPrivacyNotice, publishPrivacyNotice } from "@/lib/studio-privacy";
import { getLatestSalonTermsVersion, summarizeTermsSnapshot } from "@/lib/salon-appointments-self";
import { createAdminClient } from "@/lib/supabase/admin";

export const DEFAULT_OPENS_AT = "10:00";
export const DEFAULT_CLOSES_AT = "20:00";
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const DEFAULT_SALON_TERMS_BODY = [
  "Booking: Your appointment is reserved for the service, time and staff member shown when you book.",
  "Arrival: Please arrive a few minutes early. If you are late, your service may be shortened so the next client is not delayed.",
  "Changes and cancellations: Please reschedule or cancel from My appointments as early as possible so the time can be offered to someone else.",
  "Payment: Pay at the studio unless you choose package credits or online payment. Deposits and online payments are handled under the studio's refund policy.",
  "Health: Tell us about allergies, skin conditions or medical concerns before your service.",
].join("\n\n");

export type BookingSetupIssue = { label: string; href: string };

export type BookingReadinessItem = {
  key: "location_hours" | "staff_locations" | "staff_hours" | "service_locations" | "service_staff" | "terms" | "privacy";
  label: string;
  done: boolean;
  issues: BookingSetupIssue[];
  href: string;
};

export type BookingServiceStatus = { id: string; name: string; bookable: boolean; reason: string | null };

type SetupSnapshot = {
  locations: Array<{ id: string; name: string }>;
  locationHours: Map<string, Array<{ weekday: number; is_closed: boolean; opens_at: string | null; closes_at: string | null }>>;
  employees: Array<{ id: string; display_name: string }>;
  employeeLocations: Map<string, Set<string>>;
  employeeHourKeys: Set<string>;
  services: Array<{ id: string; title: string; online_bookable: boolean | null }>;
  serviceLocations: Map<string, Set<string>>;
  serviceEmployees: Map<string, Set<string>>;
  hasTerms: boolean;
  hasPrivacy: boolean;
};

function pushTo<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const existing = map.get(key) ?? new Set<V>();
  existing.add(value);
  map.set(key, existing);
}

async function loadSetupSnapshot(studioId: string): Promise<SetupSnapshot> {
  const admin = createAdminClient();
  const [
    locationRes,
    hoursRes,
    employeeRes,
    employeeLocationRes,
    employeeHoursRes,
    serviceRes,
    serviceLocationRes,
    serviceEmployeeRes,
    terms,
    privacy,
  ] = await Promise.all([
    admin.from("locations").select("id, name").eq("studio_id", studioId).eq("is_active", true).order("name"),
    admin.from("location_operating_hours").select("location_id, weekday, is_closed, opens_at, closes_at").eq("studio_id", studioId),
    admin.from("employees").select("id, display_name, employment_status").eq("studio_id", studioId).order("display_name"),
    admin.from("employee_locations").select("employee_id, location_id").eq("studio_id", studioId).eq("is_active", true),
    admin.from("employee_working_hours").select("employee_id, location_id").eq("studio_id", studioId).eq("is_active", true),
    admin.from("studio_services").select("id, title, online_bookable").eq("studio_id", studioId).eq("is_active", true).order("sort_order").order("title"),
    admin.from("service_locations").select("service_id, location_id").eq("studio_id", studioId).eq("is_enabled", true),
    admin.from("service_employees").select("service_id, employee_id").eq("studio_id", studioId).eq("is_active", true),
    getLatestSalonTermsVersion({ studioId }),
    getLatestPrivacyNotice({ studioId }),
  ]);
  const queryError = [
    locationRes.error,
    hoursRes.error,
    employeeRes.error,
    employeeLocationRes.error,
    employeeHoursRes.error,
    serviceRes.error,
    serviceLocationRes.error,
    serviceEmployeeRes.error,
  ].find(Boolean);
  if (queryError) throw queryError;

  const locations = locationRes.data ?? [];
  const activeLocationIds = new Set(locations.map((row) => row.id));
  const employees = (employeeRes.data ?? []).filter(
    (row) => String(row.employment_status ?? "active").toLowerCase() === "active",
  );
  const activeEmployeeIds = new Set(employees.map((row) => row.id));

  const locationHours: SetupSnapshot["locationHours"] = new Map();
  for (const row of hoursRes.data ?? []) {
    const existing = locationHours.get(row.location_id) ?? [];
    existing.push(row);
    locationHours.set(row.location_id, existing);
  }
  const employeeLocations: SetupSnapshot["employeeLocations"] = new Map();
  for (const row of employeeLocationRes.data ?? []) {
    if (activeLocationIds.has(row.location_id)) pushTo(employeeLocations, row.employee_id, row.location_id);
  }
  const serviceLocations: SetupSnapshot["serviceLocations"] = new Map();
  for (const row of serviceLocationRes.data ?? []) {
    if (activeLocationIds.has(row.location_id)) pushTo(serviceLocations, row.service_id, row.location_id);
  }
  const serviceEmployees: SetupSnapshot["serviceEmployees"] = new Map();
  for (const row of serviceEmployeeRes.data ?? []) {
    if (activeEmployeeIds.has(row.employee_id)) pushTo(serviceEmployees, row.service_id, row.employee_id);
  }

  return {
    locations,
    locationHours,
    employees,
    employeeLocations,
    employeeHourKeys: new Set((employeeHoursRes.data ?? []).map((row) => `${row.employee_id}:${row.location_id}`)),
    services: serviceRes.data ?? [],
    serviceLocations,
    serviceEmployees,
    hasTerms: Boolean(terms?.id),
    hasPrivacy: Boolean(privacy?.id),
  };
}

function hasOpenHours(snapshot: SetupSnapshot, locationId: string) {
  return (snapshot.locationHours.get(locationId) ?? []).some((row) => !row.is_closed && row.opens_at && row.closes_at);
}

function serviceBlocker(snapshot: SetupSnapshot, serviceId: string): string | null {
  if (snapshot.services.find((service) => service.id === serviceId)?.online_bookable === false) {
    return "Online booking is turned off for this service";
  }
  const locationIds = [...(snapshot.serviceLocations.get(serviceId) ?? [])];
  if (!locationIds.length) return "Not offered at any location";
  const employeeIds = [...(snapshot.serviceEmployees.get(serviceId) ?? [])];
  if (!employeeIds.length) return "No staff can do this service";
  const bookableSomewhere = locationIds.some((locationId) =>
    hasOpenHours(snapshot, locationId)
    && employeeIds.some((employeeId) =>
      snapshot.employeeLocations.get(employeeId)?.has(locationId)
      && snapshot.employeeHourKeys.has(`${employeeId}:${locationId}`),
    ),
  );
  if (!bookableSomewhere) return "No staff with working hours at an open location";
  return null;
}

export async function getBookingReadiness(params: { studioId: string }) {
  const snapshot = await loadSetupSnapshot(params.studioId);
  const locationById = new Map(snapshot.locations.map((row) => [row.id, row.name]));

  const staffHourIssues: BookingSetupIssue[] = [];
  for (const employee of snapshot.employees) {
    for (const locationId of snapshot.employeeLocations.get(employee.id) ?? []) {
      if (!snapshot.employeeHourKeys.has(`${employee.id}:${locationId}`)) {
        staffHourIssues.push({
          label: `${employee.display_name} · ${locationById.get(locationId) ?? "location"}`,
          href: "/dashboard/settings/booking?tab=staff",
        });
      }
    }
  }

  const items: BookingReadinessItem[] = [
    {
      key: "location_hours",
      label: "Locations have opening hours",
      href: "/dashboard/settings/booking?tab=hours",
      issues: snapshot.locations
        .filter((location) => !hasOpenHours(snapshot, location.id))
        .map((location) => ({ label: location.name, href: "/dashboard/settings/booking?tab=hours" })),
      done: false,
    },
    {
      key: "staff_locations",
      label: "Staff are assigned to a location",
      href: "/dashboard/staff",
      issues: snapshot.employees
        .filter((employee) => !snapshot.employeeLocations.get(employee.id)?.size)
        .map((employee) => ({ label: employee.display_name, href: "/dashboard/staff" })),
      done: false,
    },
    {
      key: "staff_hours",
      label: "Staff have working hours",
      href: "/dashboard/settings/booking?tab=staff",
      issues: staffHourIssues,
      done: false,
    },
    {
      key: "service_locations",
      label: "Services are offered at a location",
      href: "/dashboard/settings/booking?tab=services",
      issues: snapshot.services
        .filter((service) => !snapshot.serviceLocations.get(service.id)?.size)
        .map((service) => ({ label: service.title, href: "/dashboard/settings/booking?tab=services" })),
      done: false,
    },
    {
      key: "service_staff",
      label: "Services have staff who can do them",
      href: "/dashboard/settings/booking?tab=services",
      issues: snapshot.services
        .filter((service) => !snapshot.serviceEmployees.get(service.id)?.size)
        .map((service) => ({ label: service.title, href: "/dashboard/settings/booking?tab=services" })),
      done: false,
    },
    {
      key: "terms",
      label: "Booking terms published",
      href: "/dashboard/settings/booking?tab=rules",
      issues: snapshot.hasTerms ? [] : [{ label: "No booking terms yet", href: "/dashboard/settings/booking?tab=rules" }],
      done: false,
    },
    {
      key: "privacy",
      label: "Privacy consent version saved",
      href: "/dashboard/settings/booking?tab=rules",
      issues: snapshot.hasPrivacy ? [] : [{ label: "No consent version yet", href: "/dashboard/settings/booking?tab=rules" }],
      done: false,
    },
  ].map((item) => ({ ...item, done: item.issues.length === 0 })) as BookingReadinessItem[];

  const services: BookingServiceStatus[] = snapshot.services.map((service) => {
    const reason = serviceBlocker(snapshot, service.id);
    return { id: service.id, name: service.title, bookable: !reason && snapshot.hasTerms && snapshot.hasPrivacy, reason };
  });

  return {
    items,
    services,
    hasLocations: snapshot.locations.length > 0,
    hasEmployees: snapshot.employees.length > 0,
    hasServices: snapshot.services.length > 0,
    ready: items.every((item) => item.done) && services.some((service) => service.bookable),
  };
}

type SetupFailure = { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string };

function fail(step: string, result: SetupFailure): SetupFailure {
  return { ok: false, reason: result.reason, message: `${step}: ${result.message ?? result.reason}` };
}

/**
 * Fill booking-setup gaps with recommended defaults. Only rows that are
 * missing are written; existing hours, assignments and versions are never
 * overwritten. Each step reuses the guarded helper for that setting, so
 * owner/manager checks and audits stay unchanged.
 */
export async function applyRecommendedBookingSetup(params: {
  userId: string;
  studioId: string;
}): Promise<{ ok: true; changes: string[] } | SetupFailure> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;

  const snapshot = await loadSetupSnapshot(params.studioId);
  const changes: string[] = [];
  const allLocationIds = snapshot.locations.map((row) => row.id);

  // 1. Locations with no hours at all → every day 10:00–20:00.
  const locationsWithoutHours = snapshot.locations.filter((location) => !snapshot.locationHours.get(location.id)?.length);
  for (const location of locationsWithoutHours) {
    const result = await setLocationOperatingHoursForWeek({
      userId: params.userId,
      studioId: params.studioId,
      locationId: location.id,
      days: WEEKDAYS.map((weekday) => ({
        weekday,
        isClosed: false,
        intervals: [{ opens_at: DEFAULT_OPENS_AT, closes_at: DEFAULT_CLOSES_AT }],
      })),
    });
    if (!result.ok) return fail(`Opening hours for ${location.name}`, result);
    snapshot.locationHours.set(
      location.id,
      WEEKDAYS.map((weekday) => ({ weekday, is_closed: false, opens_at: DEFAULT_OPENS_AT, closes_at: DEFAULT_CLOSES_AT })),
    );
  }
  if (locationsWithoutHours.length) {
    changes.push(`Set opening hours (10:00–20:00 daily) for ${locationsWithoutHours.length} location(s)`);
  }

  // 2. Staff with no location → all active locations.
  let staffAssigned = 0;
  if (allLocationIds.length) {
    for (const employee of snapshot.employees) {
      if (snapshot.employeeLocations.get(employee.id)?.size) continue;
      const result = await setEmployeeWorkingLocations({
        userId: params.userId,
        studioId: params.studioId,
        employeeId: employee.id,
        locationIds: allLocationIds,
        primaryLocationId: allLocationIds[0],
      });
      if (!result.ok) return fail(`Locations for ${employee.display_name}`, result);
      snapshot.employeeLocations.set(employee.id, new Set(allLocationIds));
      staffAssigned += 1;
    }
  }
  if (staffAssigned) changes.push(`Assigned ${staffAssigned} staff member(s) to all locations`);

  // 3. Staff with no hours at a location → copy that location's opening hours.
  let schedulesCreated = 0;
  for (const employee of snapshot.employees) {
    for (const locationId of snapshot.employeeLocations.get(employee.id) ?? []) {
      if (snapshot.employeeHourKeys.has(`${employee.id}:${locationId}`)) continue;
      const hours = snapshot.locationHours.get(locationId) ?? [];
      const days = WEEKDAYS.map((weekday) => ({
        weekday,
        intervals: hours
          .filter((row) => row.weekday === weekday && !row.is_closed && row.opens_at && row.closes_at)
          .map((row) => ({ starts_at: String(row.opens_at).slice(0, 5), ends_at: String(row.closes_at).slice(0, 5) })),
      }));
      if (!days.some((day) => day.intervals.length)) continue;
      const result = await setEmployeeWorkingHoursForWeek({
        userId: params.userId,
        studioId: params.studioId,
        employeeId: employee.id,
        locationId,
        days,
      });
      if (!result.ok) return fail(`Working hours for ${employee.display_name}`, result);
      snapshot.employeeHourKeys.add(`${employee.id}:${locationId}`);
      schedulesCreated += 1;
    }
  }
  if (schedulesCreated) changes.push(`Created ${schedulesCreated} staff schedule(s) from opening hours`);

  // 4. Services not offered anywhere → all locations.
  let servicesPublished = 0;
  if (allLocationIds.length) {
    for (const service of snapshot.services) {
      if (snapshot.serviceLocations.get(service.id)?.size) continue;
      const result = await setServicePublishScope({
        userId: params.userId,
        studioId: params.studioId,
        serviceId: service.id,
        scope: "all_locations",
      });
      if (!result.ok) return fail(`Locations for ${service.title}`, result);
      servicesPublished += 1;
    }
  }
  if (servicesPublished) changes.push(`Offered ${servicesPublished} service(s) at all locations`);

  // 5. Services with no eligible staff → all active staff.
  let servicesStaffed = 0;
  const allEmployeeIds = snapshot.employees.map((row) => row.id);
  if (allEmployeeIds.length) {
    for (const service of snapshot.services) {
      if (snapshot.serviceEmployees.get(service.id)?.size) continue;
      const result = await setServiceEmployeeEligibilities({
        userId: params.userId,
        studioId: params.studioId,
        serviceId: service.id,
        employeeIds: allEmployeeIds,
      });
      if (!result.ok) return fail(`Staff for ${service.title}`, result);
      servicesStaffed += 1;
    }
  }
  if (servicesStaffed) changes.push(`Let all staff do ${servicesStaffed} service(s)`);

  // 6–7. Default booking terms and privacy consent version.
  if (!snapshot.hasTerms) {
    const result = await publishSalonTermsVersion({
      userId: params.userId,
      studioId: params.studioId,
      body: DEFAULT_SALON_TERMS_BODY,
    });
    if (!result.ok) return fail("Booking terms", result);
    changes.push(`Published default booking terms (${result.versionLabel})`);
  }
  if (!snapshot.hasPrivacy) {
    const result = await publishPrivacyNotice({ userId: params.userId, studioId: params.studioId });
    if (!result.ok) return fail("Privacy consent", result);
    changes.push(`Saved privacy consent version ${result.versionLabel}`);
  }

  return { ok: true, changes };
}

export async function getCurrentSalonTermsText(params: { studioId: string }) {
  const latest = await getLatestSalonTermsVersion({ studioId: params.studioId });
  return {
    versionLabel: latest?.version_label ?? null,
    body: latest ? summarizeTermsSnapshot(latest.content_snapshot) : "",
  };
}

/** Publish booking terms; republishing identical text re-activates that version. */
export async function publishSalonTermsVersion(params: {
  userId: string;
  studioId: string;
  body: string;
}): Promise<{ ok: true; versionLabel: string } | SetupFailure> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;

  const body = params.body.replace(/\r\n/g, "\n").trim();
  if (body.length < 20) return { ok: false, reason: "invalid_request", message: "Terms are too short." };
  if (body.length > 10_000) return { ok: false, reason: "invalid_request", message: "Terms are too long." };

  const snapshot = { title: "Booking terms", body };
  const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await admin
    .from("salon_terms_versions")
    .select("id, version_label, content_hash")
    .eq("studio_id", params.studioId);
  if (existingError) return { ok: false, reason: "invalid_request", message: existingError.message };

  const same = (existing ?? []).find((row) => row.content_hash === contentHash);
  if (same) {
    const { error } = await admin
      .from("salon_terms_versions")
      .update({ is_active: true, published_at: nowIso })
      .eq("id", same.id)
      .eq("studio_id", params.studioId);
    if (error) return { ok: false, reason: "invalid_request", message: error.message };
    return { ok: true, versionLabel: same.version_label };
  }

  const versionLabel = `terms-v${(existing?.length ?? 0) + 1}`;
  const { error } = await admin.from("salon_terms_versions").insert({
    studio_id: params.studioId,
    version_label: versionLabel,
    content_hash: contentHash,
    content_snapshot: snapshot,
    is_active: true,
    published_at: nowIso,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true, versionLabel };
}

export async function updateBookingRules(params: {
  userId: string;
  studioId: string;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  changeCutoffHours: number;
}): Promise<{ ok: true } | SetupFailure> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;
  const { minNoticeMinutes, maxAdvanceDays, changeCutoffHours } = params;
  if (
    !Number.isInteger(minNoticeMinutes) || minNoticeMinutes < 0 || minNoticeMinutes > 10080
    || !Number.isInteger(maxAdvanceDays) || maxAdvanceDays < 1 || maxAdvanceDays > 365
    || !Number.isInteger(changeCutoffHours) || changeCutoffHours < 0 || changeCutoffHours > 168
  ) {
    return {
      ok: false,
      reason: "invalid_request",
      message: "Notice must be 0–10080 minutes, booking ahead 1–365 days, and change cutoff 0–168 hours.",
    };
  }

  const { error } = await createAdminClient()
    .from("studios")
    .update({
      appointment_min_notice_minutes: minNoticeMinutes,
      appointment_max_advance_days: maxAdvanceDays,
      appointment_change_cutoff_hours: changeCutoffHours,
    })
    .eq("id", params.studioId);
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

export async function setServiceOnlineBookable(params: {
  userId: string;
  studioId: string;
  serviceId: string;
  onlineBookable: boolean;
}): Promise<{ ok: true } | SetupFailure> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;
  const { error } = await createAdminClient()
    .from("studio_services")
    .update({ online_bookable: params.onlineBookable })
    .eq("id", params.serviceId)
    .eq("studio_id", params.studioId);
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

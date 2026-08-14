import "server-only";

import { hashIdempotencyRequest, claimIdempotencyKey, failIdempotencyKey, type IdempotencyClaimResult } from "@/lib/idempotency";
import { createHitpayPaymentRequest } from "@/lib/hitpay";
import { localISODate, parseDatetimeLocalAsSgt } from "@/lib/date";
import { createAdminClient } from "@/lib/supabase/admin";

const SLOT_STEP_MINUTES = 15;
const ACTIVE_APPOINTMENT_STATUSES = ["pending", "confirmed", "checked_in", "in_progress"];
const TIMEZONE = "Asia/Singapore";

type AppointmentConflictCode =
  | "slot_conflict"
  | "resource_conflict"
  | "scope_violation"
  | "availability_violation"
  | "not_found"
  | "invalid_request"
  | "forbidden"
  | "studio_not_found"
  | "studio_suspended"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "idempotency_stale_claim"
  | "idempotency_permanently_failed"
  | "payment_create_failed"
  | "payment_config_missing"
  | "payment_source_invalid"
  | "insufficient_credits"
  | "package_not_eligible"
  | "unknown";

type AppointmentMutationResult<TPayload> =
  | { ok: true; payload: TPayload }
  | { ok: false; code: AppointmentConflictCode; message: string; detail?: string };

type SelfAppointmentRow = {
  id: string;
  studio_id: string;
  location_id: string;
  salon_customer_id: string;
  service_id: string;
  employee_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  occupied_from: string;
  occupied_until: string;
  expires_at: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  service_title_snapshot: string;
  service_price_snapshot: number;
  service_currency_snapshot: string;
  employee_name_snapshot: string;
  location_name_snapshot: string;
  created_at: string;
  updated_at: string;
};

export type SelfAppointment = SelfAppointmentRow;

export type SelfBookableLocation = { id: string; name: string };

export type SelfBookableService = {
  id: string;
  name: string;
  locationIds: string[];
  defaultDurationMinutes: number;
  defaultPrepMinutes: number;
  defaultBufferMinutes: number;
};

export type SelfBookableSlot = {
  startsAtIso: string;
  endsAtIso: string;
  employeeId: string;
  employeeName: string;
  resourceIds: string[];
};

export type SelfSettlementOption = "free" | "package_credit" | "online_deposit" | "online_full";

export type SelfEligiblePackageCredit = {
  clientPackageId: string;
  packageId: string;
  packageName: string;
  creditsLeft: number;
  expiryDate: string | null;
  locationId: string | null;
};

type ServiceTiming = {
  durationMinutes: number;
  prepMinutes: number;
  bufferMinutes: number;
};

type TimeInterval = { startSecond: number; endSecond: number };

function mapRpcError(error: { code?: string; message?: string } | null): {
  code: AppointmentConflictCode;
  message: string;
} {
  const message = error?.message ?? "Appointment mutation failed.";
  if (!error?.code) {
    if (/overlap|conflict|exclude/i.test(message)) {
      return { code: "slot_conflict", message };
    }
    return { code: "unknown", message };
  }

  switch (error.code) {
    case "P0002":
      return { code: "not_found", message };
    case "42501":
      return { code: "forbidden", message };
    case "23P01":
      if (/resource|salon_appointment_resources_no_overlap/i.test(message)) {
        return { code: "resource_conflict", message };
      }
      return { code: "slot_conflict", message };
    case "23514":
      if (/no eligible package credits|insufficient package credits/i.test(message)) {
        return { code: "insufficient_credits", message };
      }
      if (/package settlement requires|package settlement|missing consume ledger|not_package_settlement/i.test(message)) {
        return { code: "package_not_eligible", message };
      }
      if (/trusted pos_sale payment source|payment->sale->settlement->appointment chain mismatch|payment amount .* does not match expected/i.test(message)) {
        return { code: "payment_source_invalid", message };
      }
      if (/idempotency|claim token|not_current_claim/i.test(message)) {
        return { code: "idempotency_stale_claim", message };
      }
      if (/resource/i.test(message) && /overlap|conflict|exclude/i.test(message)) {
        return { code: "resource_conflict", message };
      }
      if (/overlap|conflict|exclude/i.test(message)) {
        return { code: "slot_conflict", message };
      }
      if (/scope|studio|location|cross|outside/i.test(message)) {
        return { code: "scope_violation", message };
      }
      if (/availability|working hours|exception|enabled|eligible|resource/i.test(message)) {
        return { code: "availability_violation", message };
      }
      return { code: "invalid_request", message };
    default:
      if (/overlap|conflict|exclude/i.test(message)) {
        return { code: "slot_conflict", message };
      }
      return { code: "unknown", message };
  }
}

function parseIdempotencyClaim(
  claim: IdempotencyClaimResult,
): { continue: true; claimId: string; claimToken: string } | AppointmentMutationResult<never> {
  if (claim.ok && claim.outcome === "claimed") {
    return { continue: true, claimId: claim.id, claimToken: claim.claimToken };
  }

  if (claim.ok && claim.outcome === "already_completed") {
    return { ok: true, payload: (claim.result ?? null) as never };
  }

  if (claim.ok && claim.outcome === "in_progress") {
    return {
      ok: false,
      code: "idempotency_in_progress",
      message: "Another request with the same idempotency key is in progress.",
    };
  }

  if (!claim.ok && claim.outcome === "hash_conflict") {
    return {
      ok: false,
      code: "idempotency_conflict",
      message: "Idempotency key was reused with a different payload.",
    };
  }

  return {
    ok: false,
    code: "idempotency_permanently_failed",
    message: "The idempotency key is marked permanently failed.",
  };
}

async function withSelfAppointmentIdempotency<TPayload>(params: {
  studioId: string;
  operationScope: string;
  idempotencyKey: string;
  requestPayload: unknown;
  run: (params: { idempotencyRecordId: string; claimToken: string }) => Promise<AppointmentMutationResult<TPayload>>;
}): Promise<AppointmentMutationResult<TPayload>> {
  const requestHash = hashIdempotencyRequest(params.requestPayload);
  const claim = await claimIdempotencyKey({
    studioId: params.studioId,
    operationScope: params.operationScope,
    idempotencyKey: params.idempotencyKey,
    requestHash,
  });
  const parsedClaim = parseIdempotencyClaim(claim);
  if (!("continue" in parsedClaim)) return parsedClaim as AppointmentMutationResult<TPayload>;

  try {
    const result = await params.run({
      idempotencyRecordId: parsedClaim.claimId,
      claimToken: parsedClaim.claimToken,
    });
    if (!result.ok) {
      await failIdempotencyKey({
        recordId: parsedClaim.claimId,
        claimToken: parsedClaim.claimToken,
        errorSummary: result.message.slice(0, 500),
        retryable: true,
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected appointment mutation error.";
    await failIdempotencyKey({
      recordId: parsedClaim.claimId,
      claimToken: parsedClaim.claimToken,
      errorSummary: message.slice(0, 500),
      retryable: true,
    });
    throw error;
  }
}

function toSgtDateParts(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  if (!year || !month || !day) return null;
  return { ymd: `${year}-${month}-${day}` };
}

function toUtcIsoFromSgt(dateYmd: string, hour: number, minute: number) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateYmd}T${hh}:${mm}:00+08:00`).toISOString();
}

function parseTimeSeconds(raw: string | null | undefined) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  const ss = Number(parts[2] ?? 0);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || !Number.isInteger(ss)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

function intervalOverlaps(startMs: number, endMs: number, targetStartMs: number, targetEndMs: number) {
  return startMs < targetEndMs && endMs > targetStartMs;
}

function isWithinIntervals(targetStartSecond: number, targetEndSecond: number, intervals: TimeInterval[]) {
  if (!intervals.length) return false;
  return intervals.some((interval) => interval.startSecond <= targetStartSecond && interval.endSecond >= targetEndSecond);
}

function intersectsUnavailable(
  unavailableRanges: Array<{ startMs: number; endMs: number }>,
  targetStartMs: number,
  targetEndMs: number,
) {
  return unavailableRanges.some((range) => intervalOverlaps(range.startMs, range.endMs, targetStartMs, targetEndMs));
}

function isCoveredByAvailableException(
  availableRanges: Array<{ startMs: number; endMs: number }>,
  targetStartMs: number,
  targetEndMs: number,
) {
  if (!availableRanges.length) return false;
  const ordered = [...availableRanges].sort((a, b) => a.startMs - b.startMs);
  let cursor = targetStartMs;
  for (const range of ordered) {
    if (range.endMs <= cursor) continue;
    if (range.startMs > cursor) return false;
    cursor = Math.max(cursor, range.endMs);
    if (cursor >= targetEndMs) return true;
  }
  return false;
}

export async function resolveSelfSalonCustomer(params: { studioId: string; userId: string }) {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("salon_customers")
    .select("id, status, merged_into_id")
    .eq("studio_id", params.studioId)
    .eq("user_id", params.userId)
    .is("merged_into_id", null)
    .maybeSingle<{ id: string; status: string; merged_into_id: string | null }>();
  if (error) throw error;
  if (!row?.id) return { ok: false as const, reason: "not_found" as const };
  if ((row.status ?? "active") !== "active") return { ok: false as const, reason: "inactive" as const };
  return { ok: true as const, salonCustomerId: row.id };
}

export async function listSelfBookableCatalog(params: { studioId: string }) {
  const admin = createAdminClient();
  const [locationRes, serviceRes, serviceLocationRes] = await Promise.all([
    admin.from("locations").select("id, name").eq("studio_id", params.studioId).eq("is_active", true).order("name"),
    admin
      .from("studio_services")
      .select("id, title, is_active, default_duration_minutes, default_prep_minutes, default_buffer_minutes")
      .eq("studio_id", params.studioId)
      .eq("is_active", true)
      .order("sort_order")
      .order("title"),
    admin
      .from("service_locations")
      .select("service_id, location_id")
      .eq("studio_id", params.studioId)
      .eq("is_enabled", true),
  ]);
  if (locationRes.error) throw locationRes.error;
  if (serviceRes.error) throw serviceRes.error;
  if (serviceLocationRes.error) throw serviceLocationRes.error;

  const locationIds = new Set((locationRes.data ?? []).map((row) => row.id));
  const serviceToLocations = new Map<string, string[]>();
  for (const row of serviceLocationRes.data ?? []) {
    if (!locationIds.has(row.location_id)) continue;
    const existing = serviceToLocations.get(row.service_id) ?? [];
    existing.push(row.location_id);
    serviceToLocations.set(row.service_id, existing);
  }

  const services: SelfBookableService[] = (serviceRes.data ?? [])
    .map((service) => ({
      id: service.id,
      name: service.title,
      locationIds: Array.from(new Set(serviceToLocations.get(service.id) ?? [])),
      defaultDurationMinutes: Number(service.default_duration_minutes ?? 60),
      defaultPrepMinutes: Number(service.default_prep_minutes ?? 0),
      defaultBufferMinutes: Number(service.default_buffer_minutes ?? 0),
    }))
    .filter((service) => service.locationIds.length > 0);

  return {
    locations: (locationRes.data ?? []) as SelfBookableLocation[],
    services,
  };
}

async function getEffectiveServiceTiming(params: {
  studioId: string;
  serviceId: string;
  locationId: string;
}): Promise<ServiceTiming> {
  const admin = createAdminClient();
  const [serviceRes, serviceLocationRes] = await Promise.all([
    admin
      .from("studio_services")
      .select("default_duration_minutes, default_prep_minutes, default_buffer_minutes")
      .eq("id", params.serviceId)
      .eq("studio_id", params.studioId)
      .eq("is_active", true)
      .maybeSingle<{ default_duration_minutes: number; default_prep_minutes: number; default_buffer_minutes: number }>(),
    admin
      .from("service_locations")
      .select("duration_override_minutes, buffer_override_minutes, is_enabled")
      .eq("studio_id", params.studioId)
      .eq("service_id", params.serviceId)
      .eq("location_id", params.locationId)
      .eq("is_enabled", true)
      .maybeSingle<{ duration_override_minutes: number | null; buffer_override_minutes: number | null; is_enabled: boolean }>(),
  ]);

  if (serviceRes.error) throw serviceRes.error;
  if (serviceLocationRes.error) throw serviceLocationRes.error;
  if (!serviceRes.data || !serviceLocationRes.data?.is_enabled) {
    throw new Error("Service is not bookable at the selected location.");
  }

  return {
    durationMinutes: Number(serviceLocationRes.data.duration_override_minutes ?? serviceRes.data.default_duration_minutes ?? 60),
    prepMinutes: Number(serviceRes.data.default_prep_minutes ?? 0),
    bufferMinutes: Number(serviceLocationRes.data.buffer_override_minutes ?? serviceRes.data.default_buffer_minutes ?? 0),
  };
}

function buildIntervalsByEmployee(
  workingHours: Array<{ employee_id: string; starts_at: string; ends_at: string; effective_from: string | null; effective_until: string | null }>,
  targetDate: string,
) {
  const map = new Map<string, TimeInterval[]>();
  for (const row of workingHours) {
    if (row.effective_from && targetDate < row.effective_from) continue;
    if (row.effective_until && targetDate > row.effective_until) continue;
    const startSecond = parseTimeSeconds(row.starts_at);
    const endSecond = parseTimeSeconds(row.ends_at);
    if (startSecond == null || endSecond == null || endSecond <= startSecond) continue;
    const existing = map.get(row.employee_id) ?? [];
    existing.push({ startSecond, endSecond });
    map.set(row.employee_id, existing);
  }
  return map;
}

export async function listSelfBookableSlots(params: {
  studioId: string;
  locationId: string;
  serviceId: string;
  dateYmd?: string;
  nowIso?: string;
}): Promise<AppointmentMutationResult<{ dateYmd: string; slots: SelfBookableSlot[] }>> {
  const dateYmd = String(params.dateYmd ?? localISODate()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return { ok: false, code: "invalid_request", message: "Invalid date." };
  }

  const weekday = Number(new Date(`${dateYmd}T00:00:00+08:00`).getUTCDay());
  const timing = await getEffectiveServiceTiming({
    studioId: params.studioId,
    locationId: params.locationId,
    serviceId: params.serviceId,
  });

  const admin = createAdminClient();
  const dayStartIso = `${dateYmd}T00:00:00+08:00`;
  const dayEndIso = `${dateYmd}T23:59:59+08:00`;
  const [
    locationHoursRes,
    assignmentRes,
    eligibilityRes,
    employeesRes,
    workingHoursRes,
    exceptionsRes,
    appointmentRes,
    requirementsRes,
    resourcesRes,
    busyResourceRes,
  ] = await Promise.all([
    admin
      .from("location_operating_hours")
      .select("opens_at, closes_at, is_closed")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .eq("weekday", weekday),
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
      .from("employees")
      .select("id, display_name, employment_status")
      .eq("studio_id", params.studioId),
    admin
      .from("employee_working_hours")
      .select("employee_id, starts_at, ends_at, effective_from, effective_until")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .eq("weekday", weekday)
      .eq("is_active", true),
    admin
      .from("employee_availability_exceptions")
      .select("employee_id, exception_type, starts_at, ends_at")
      .eq("studio_id", params.studioId)
      .or(`location_id.is.null,location_id.eq.${params.locationId}`)
      .lte("starts_at", dayEndIso)
      .gte("ends_at", dayStartIso),
    admin
      .from("salon_appointments")
      .select("employee_id, occupied_from, occupied_until")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .in("status", ACTIVE_APPOINTMENT_STATUSES)
      .lte("occupied_from", dayEndIso)
      .gte("occupied_until", dayStartIso),
    admin
      .from("service_resource_requirements")
      .select("resource_type, required_quantity")
      .eq("studio_id", params.studioId)
      .eq("service_id", params.serviceId),
    admin
      .from("salon_resources")
      .select("id, resource_type")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .eq("is_active", true),
    admin
      .from("salon_appointment_resources")
      .select("resource_id, occupied_from, occupied_until")
      .eq("studio_id", params.studioId)
      .eq("location_id", params.locationId)
      .eq("is_active", true)
      .lte("occupied_from", dayEndIso)
      .gte("occupied_until", dayStartIso),
  ]);

  const queryError = [
    locationHoursRes.error,
    assignmentRes.error,
    eligibilityRes.error,
    employeesRes.error,
    workingHoursRes.error,
    exceptionsRes.error,
    appointmentRes.error,
    requirementsRes.error,
    resourcesRes.error,
    busyResourceRes.error,
  ].find(Boolean);
  if (queryError) throw queryError;

  const locationHours = locationHoursRes.data ?? [];
  const hasClosedMarker = locationHours.some((row) => row.is_closed);
  if (hasClosedMarker || locationHours.length === 0) {
    return { ok: true, payload: { dateYmd, slots: [] } };
  }

  const locationIntervals: TimeInterval[] = locationHours
    .map((row) => ({ startSecond: parseTimeSeconds(row.opens_at), endSecond: parseTimeSeconds(row.closes_at) }))
    .filter((row): row is TimeInterval => row.startSecond != null && row.endSecond != null && row.endSecond > row.startSecond)
    .sort((left, right) => left.startSecond - right.startSecond);
  if (!locationIntervals.length) return { ok: true, payload: { dateYmd, slots: [] } };

  const assignmentSet = new Set((assignmentRes.data ?? []).map((row) => row.employee_id));
  const eligibilitySet = new Set((eligibilityRes.data ?? []).map((row) => row.employee_id));
  const employeeRows = (employeesRes.data ?? []).filter(
    (employee) => assignmentSet.has(employee.id) && eligibilitySet.has(employee.id),
  );

  const targetEmployeeIds = new Set(employeeRows.map((row) => row.id));
  const activeEmployees = employeeRows.filter(
    (employee) => String(employee.employment_status ?? "active").toLowerCase() === "active",
  );
  const workingIntervals = buildIntervalsByEmployee(workingHoursRes.data ?? [], dateYmd);

  const employeeExceptions = new Map<string, { unavailable: Array<{ startMs: number; endMs: number }>; available: Array<{ startMs: number; endMs: number }> }>();
  for (const row of exceptionsRes.data ?? []) {
    if (!targetEmployeeIds.has(row.employee_id)) continue;
    const startMs = new Date(row.starts_at).getTime();
    const endMs = new Date(row.ends_at).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const existing = employeeExceptions.get(row.employee_id) ?? { unavailable: [], available: [] };
    if (row.exception_type === "available") existing.available.push({ startMs, endMs });
    if (row.exception_type === "unavailable") existing.unavailable.push({ startMs, endMs });
    employeeExceptions.set(row.employee_id, existing);
  }

  const appointmentBusyByEmployee = new Map<string, Array<{ startMs: number; endMs: number }>>();
  for (const row of appointmentRes.data ?? []) {
    const startMs = new Date(row.occupied_from).getTime();
    const endMs = new Date(row.occupied_until).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const existing = appointmentBusyByEmployee.get(row.employee_id) ?? [];
    existing.push({ startMs, endMs });
    appointmentBusyByEmployee.set(row.employee_id, existing);
  }

  const requirements = (requirementsRes.data ?? []).map((row) => ({
    type: String(row.resource_type),
    requiredQuantity: Number(row.required_quantity ?? 0),
  })).filter((row) => row.requiredQuantity > 0);

  const resourcesByType = new Map<string, string[]>();
  for (const row of resourcesRes.data ?? []) {
    const existing = resourcesByType.get(row.resource_type) ?? [];
    existing.push(row.id);
    resourcesByType.set(row.resource_type, existing);
  }

  const busyByResource = new Map<string, Array<{ startMs: number; endMs: number }>>();
  for (const row of busyResourceRes.data ?? []) {
    const startMs = new Date(row.occupied_from).getTime();
    const endMs = new Date(row.occupied_until).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const existing = busyByResource.get(row.resource_id) ?? [];
    existing.push({ startMs, endMs });
    busyByResource.set(row.resource_id, existing);
  }

  const nowMs = params.nowIso ? new Date(params.nowIso).getTime() : Date.now();
  const slots: SelfBookableSlot[] = [];

  for (const interval of locationIntervals) {
    const earliestStartSecond = interval.startSecond + timing.prepMinutes * 60;
    const latestStartSecond = interval.endSecond - (timing.durationMinutes + timing.bufferMinutes) * 60;
    if (latestStartSecond < earliestStartSecond) continue;

    for (
      let slotStartSecond = earliestStartSecond;
      slotStartSecond <= latestStartSecond;
      slotStartSecond += SLOT_STEP_MINUTES * 60
    ) {
      const startHour = Math.floor(slotStartSecond / 3600);
      const startMinute = Math.floor((slotStartSecond % 3600) / 60);
      const startsAtIso = toUtcIsoFromSgt(dateYmd, startHour, startMinute);
      const startsAtMs = new Date(startsAtIso).getTime();
      if (!Number.isFinite(startsAtMs) || startsAtMs <= nowMs) continue;

      const endsAtMs = startsAtMs + timing.durationMinutes * 60_000;
      const occupiedFromMs = startsAtMs - timing.prepMinutes * 60_000;
      const occupiedUntilMs = endsAtMs + timing.bufferMinutes * 60_000;
      const occupiedStartSecond = slotStartSecond - timing.prepMinutes * 60;
      const occupiedEndSecond = slotStartSecond + (timing.durationMinutes + timing.bufferMinutes) * 60;

      for (const employee of activeEmployees) {
        const employeeIntervals = workingIntervals.get(employee.id) ?? [];
        const exception = employeeExceptions.get(employee.id) ?? { unavailable: [], available: [] };
        const withinWorking = isWithinIntervals(occupiedStartSecond, occupiedEndSecond, employeeIntervals);
        const availableByException = isCoveredByAvailableException(exception.available, occupiedFromMs, occupiedUntilMs);
        if (intersectsUnavailable(exception.unavailable, occupiedFromMs, occupiedUntilMs)) continue;
        if (!withinWorking && !availableByException) continue;

        const employeeBusy = appointmentBusyByEmployee.get(employee.id) ?? [];
        if (employeeBusy.some((busy) => intervalOverlaps(busy.startMs, busy.endMs, occupiedFromMs, occupiedUntilMs))) {
          continue;
        }

        const selectedResourceIds: string[] = [];
        let requirementsSatisfied = true;
        for (const requirement of requirements) {
          const candidateResources = resourcesByType.get(requirement.type) ?? [];
          const availableResources = candidateResources.filter((resourceId) => {
            const busyRanges = busyByResource.get(resourceId) ?? [];
            return !busyRanges.some((busy) => intervalOverlaps(busy.startMs, busy.endMs, occupiedFromMs, occupiedUntilMs));
          });
          if (availableResources.length < requirement.requiredQuantity) {
            requirementsSatisfied = false;
            break;
          }
          selectedResourceIds.push(...availableResources.slice(0, requirement.requiredQuantity));
        }

        if (!requirementsSatisfied) continue;

        slots.push({
          startsAtIso,
          endsAtIso: new Date(endsAtMs).toISOString(),
          employeeId: employee.id,
          employeeName: employee.display_name,
          resourceIds: selectedResourceIds,
        });
      }
    }
  }

  slots.sort((left, right) => {
    const startDiff = new Date(left.startsAtIso).getTime() - new Date(right.startsAtIso).getTime();
    if (startDiff !== 0) return startDiff;
    return left.employeeName.localeCompare(right.employeeName);
  });

  return { ok: true, payload: { dateYmd, slots } };
}

export async function listSelfAppointments(params: {
  studioId: string;
  userId: string;
}): Promise<AppointmentMutationResult<{ appointments: SelfAppointment[]; salonCustomerId: string }>> {
  const customer = await resolveSelfSalonCustomer({ studioId: params.studioId, userId: params.userId });
  if (!customer.ok) {
    return {
      ok: false,
      code: "forbidden",
      message: "Customer account is not linked to this studio.",
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("salon_appointments")
    .select(
      "id, studio_id, location_id, salon_customer_id, service_id, employee_id, status, starts_at, ends_at, occupied_from, occupied_until, expires_at, cancellation_reason, cancelled_at, service_title_snapshot, service_price_snapshot, service_currency_snapshot, employee_name_snapshot, location_name_snapshot, created_at, updated_at",
    )
    .eq("studio_id", params.studioId)
    .eq("salon_customer_id", customer.salonCustomerId)
    .order("starts_at", { ascending: false })
    .returns<SelfAppointmentRow[]>();
  if (error) throw error;
  return {
    ok: true,
    payload: {
      appointments: (data ?? []) as SelfAppointment[],
      salonCustomerId: customer.salonCustomerId,
    },
  };
}

export async function listSelfEligiblePackageCredits(params: {
  studioId: string;
  userId: string;
  locationId: string;
}): Promise<AppointmentMutationResult<{ packages: SelfEligiblePackageCredit[] }>> {
  const customer = await resolveSelfSalonCustomer({ studioId: params.studioId, userId: params.userId });
  if (!customer.ok) {
    return { ok: false, code: "forbidden", message: "Customer account is not linked to this studio." };
  }

  const admin = createAdminClient();
  const { data: customerRow, error: customerError } = await admin
    .from("salon_customers")
    .select("id, user_id")
    .eq("id", customer.salonCustomerId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; user_id: string | null }>();
  if (customerError) throw customerError;
  if (!customerRow?.user_id) {
    return { ok: false, code: "forbidden", message: "Customer account has no linked user." };
  }

  const { data, error } = await admin
    .from("client_packages")
    .select("id, package_id, credits_left, expiry_date, package_name_snapshot, packages!inner(id, studio_id, name, location_id, is_active)")
    .eq("client_id", customerRow.user_id)
    .gt("credits_left", 0)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .returns<Array<{
      id: string;
      package_id: string;
      credits_left: number;
      expiry_date: string | null;
      package_name_snapshot: string | null;
      packages:
        | {
            id: string;
            studio_id: string;
            name: string;
            location_id: string | null;
            is_active: boolean;
          }
        | Array<{
            id: string;
            studio_id: string;
            name: string;
            location_id: string | null;
            is_active: boolean;
          }>;
    }>>();
  if (error) throw error;

  const packages = (data ?? [])
    .map((row) => {
      const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages;
      if (!pkg || pkg.studio_id !== params.studioId) return null;
      if (!pkg.is_active) return null;
      if (pkg.location_id && pkg.location_id !== params.locationId) return null;
      if (row.expiry_date && new Date(row.expiry_date).getTime() <= Date.now()) return null;
      return {
        clientPackageId: row.id,
        packageId: pkg.id,
        packageName: row.package_name_snapshot ?? pkg.name,
        creditsLeft: row.credits_left,
        expiryDate: row.expiry_date,
        locationId: pkg.location_id,
      } satisfies SelfEligiblePackageCredit;
    })
    .filter((row): row is SelfEligiblePackageCredit => Boolean(row));

  return { ok: true, payload: { packages } };
}

function computeExpectedOnlineAmount(params: {
  servicePriceAmount: number;
  settlementOption: SelfSettlementOption;
}) {
  if (params.settlementOption === "online_full") {
    return Math.round(Math.max(params.servicePriceAmount, 0) * 100) / 100;
  }
  const base = Math.round(Math.max(params.servicePriceAmount, 0) * 100) / 100;
  if (base <= 0) return 0;
  const deposit = Math.round(base * 0.3 * 100) / 100;
  return Math.max(1, deposit);
}

async function createSelfAppointmentOnlinePayment(params: {
  userId: string;
  studioId: string;
  studioSlug: string;
  appointmentId: string;
  salonCustomerId: string;
  locationId: string;
  serviceId: string;
  employeeId: string;
  serviceTitleSnapshot: string;
  servicePriceSnapshot: number;
  serviceCurrencySnapshot: string;
  settlementOption: "online_deposit" | "online_full";
}) {
  const admin = createAdminClient();
  const expectedAmount = computeExpectedOnlineAmount({
    servicePriceAmount: Number(params.servicePriceSnapshot ?? 0),
    settlementOption: params.settlementOption,
  });

  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: sale, error: saleError } = await admin
    .from("pos_sales")
    .insert({
      studio_id: params.studioId,
      location_id: params.locationId,
      salon_customer_id: params.salonCustomerId,
      cashier_user_id: null,
      status: "pending_payment",
      currency: params.serviceCurrencySnapshot,
      subtotal_amount: expectedAmount,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: expectedAmount,
      note: `APT-04 self booking ${params.appointmentId}`,
      locked_at: nowIso,
      submitted_at: nowIso,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (saleError || !sale?.id) {
    throw new Error(saleError?.message ?? "sale_create_failed");
  }

  const { error: itemError } = await admin.from("pos_sale_items").insert({
    sale_id: sale.id,
    studio_id: params.studioId,
    location_id: params.locationId,
    line_number: 1,
    item_type: "service",
    service_id: params.serviceId,
    package_id: null,
    product_id: null,
    salon_appointment_id: params.appointmentId,
    employee_id: params.employeeId,
    item_name_snapshot: params.serviceTitleSnapshot,
    item_currency_snapshot: params.serviceCurrencySnapshot,
    quantity: 1,
    unit_price_amount: expectedAmount,
    subtotal_amount: expectedAmount,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: expectedAmount,
  });
  if (itemError) throw new Error(itemError.message);

  const referenceCode = `APT-${params.appointmentId.replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .insert({
      studio_id: params.studioId,
      location_id: params.locationId,
      pos_sale_id: sale.id,
      client_id: params.userId,
      amount: expectedAmount,
      currency: params.serviceCurrencySnapshot,
      payment_method: "hitpay",
      sales_channel: "online",
      source: "pos_sale",
      status: "pending",
      reference_code: referenceCode,
      type: "single",
      remaining_uses: 0,
      service_id: params.serviceId,
      service_title_snapshot: params.serviceTitleSnapshot,
      expires_at: expiresAtIso,
    })
    .select("id")
    .single<{ id: string }>();
  if (paymentError || !payment?.id) {
    throw new Error(paymentError?.message ?? "payment_create_failed");
  }

  const { data: secrets, error: secretError } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key")
    .eq("studio_id", params.studioId)
    .maybeSingle<{ hitpay_api_key: string | null }>();
  if (secretError) throw secretError;
  const apiKey = secrets?.hitpay_api_key?.trim() ?? "";
  if (!apiKey) throw new Error("payment_config_missing");

  const appBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  if (!appBase) throw new Error("payment_config_missing");
  const returnUrl = `${appBase}/${params.studioSlug}/checkout/${payment.id}`;

  const request = await createHitpayPaymentRequest({
    apiKey,
    amount: expectedAmount.toFixed(2),
    currency: params.serviceCurrencySnapshot,
    reference_number: referenceCode,
    redirect_url: returnUrl,
    purpose: `Appointment ${params.appointmentId.slice(0, 8)}`,
  });

  const { error: paymentPatchError } = await admin
    .from("payments")
    .update({
      gateway_payment_id: request.providerPaymentId,
      gateway_checkout_url: request.checkoutUrl,
      gateway_status: request.providerStatus,
    })
    .eq("id", payment.id)
    .eq("status", "pending");
  if (paymentPatchError) throw paymentPatchError;

  return {
    posSaleId: sale.id,
    paymentId: payment.id,
    checkoutUrl: request.checkoutUrl,
    expectedAmount,
    currency: params.serviceCurrencySnapshot,
    expiresAtIso,
  };
}

export async function createSelfAppointment(params: {
  userId: string;
  studioSlug: string;
  studioId: string;
  locationId: string;
  serviceId: string;
  employeeId: string;
  startsAtIso: string;
  resourceIds: string[];
  termsVersionId: string;
  settlementOption: SelfSettlementOption;
  idempotencyKey: string;
}): Promise<AppointmentMutationResult<{ appointmentId: string; status: string; startsAt: string; endsAt: string; settlementStatus?: string; paymentId?: string | null }>> {
  const customer = await resolveSelfSalonCustomer({ studioId: params.studioId, userId: params.userId });
  if (!customer.ok) {
    return { ok: false, code: "forbidden", message: "Customer account is not linked to this studio." };
  }

  return withSelfAppointmentIdempotency<{
    appointmentId: string;
    status: string;
    startsAt: string;
    endsAt: string;
    settlementStatus?: string;
    paymentId?: string | null;
  }>({
    studioId: params.studioId,
    operationScope: "salon_appointment:create",
    idempotencyKey: params.idempotencyKey,
    requestPayload: params,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const admin = createAdminClient();
      const nowIso = new Date().toISOString();
      const { data, error } = await admin.rpc("create_salon_appointment", {
        p_actor_id: params.userId,
        p_actor_role: "customer",
        p_studio_id: params.studioId,
        p_location_id: params.locationId,
        p_salon_customer_id: customer.salonCustomerId,
        p_service_id: params.serviceId,
        p_employee_id: params.employeeId,
        p_starts_at: params.startsAtIso,
        p_resource_ids: params.resourceIds,
        p_terms_version_id: params.termsVersionId,
        p_terms_accepted_at: nowIso,
        p_terms_acceptance_channel: "self_booking_web",
        p_terms_acceptance_method: "checkbox",
        p_terms_recorded_by: params.userId,
        p_idempotency_key_id: idempotencyRecordId,
        p_idempotency_claim_token: claimToken,
      });
      if (error) {
        const mapped = mapRpcError(error);
        return { ok: false, ...mapped };
      }

      const payload = data as { appointment_id: string; status: string; starts_at: string; ends_at: string };

      const { data: appointmentSnapshot, error: appointmentSnapshotError } = await admin
        .from("salon_appointments")
        .select("id, studio_id, location_id, salon_customer_id, service_id, employee_id, service_title_snapshot, service_price_snapshot, service_currency_snapshot")
        .eq("id", payload.appointment_id)
        .eq("studio_id", params.studioId)
        .maybeSingle<{
          id: string;
          studio_id: string;
          location_id: string;
          salon_customer_id: string;
          service_id: string;
          employee_id: string;
          service_title_snapshot: string;
          service_price_snapshot: number;
          service_currency_snapshot: string;
        }>();
      if (appointmentSnapshotError) throw appointmentSnapshotError;
      if (!appointmentSnapshot?.id) {
        return { ok: false, code: "not_found", message: "Created appointment snapshot is missing." };
      }

      const servicePrice = Math.round(Math.max(Number(appointmentSnapshot.service_price_snapshot ?? 0), 0) * 100) / 100;
      const serviceCurrency = (appointmentSnapshot.service_currency_snapshot || "SGD").toUpperCase();

      if (params.settlementOption === "package_credit") {
        const consume = await admin.rpc("pkg01_apply_appointment_package_consume", {
          p_studio_id: params.studioId,
          p_appointment_id: payload.appointment_id,
          p_actor_id: params.userId,
          p_actor_role: "customer",
          p_idempotency_key_id: idempotencyRecordId,
          p_correlation_id: `apt04:${payload.appointment_id}:package_consume`,
        });
        if (consume.error) {
          const mapped = mapRpcError(consume.error);
          return { ok: false, ...mapped };
        }

        const consumePayload = (consume.data ?? {}) as {
          ok?: boolean;
          client_package_id?: string;
          ledger_entry_id?: string;
        };
        if (!consumePayload.ok || !consumePayload.client_package_id || !consumePayload.ledger_entry_id) {
          return { ok: false, code: "package_not_eligible", message: "Package consume failed." };
        }

        const settlement = await admin.rpc("apt04_upsert_appointment_settlement", {
          p_actor_id: params.userId,
          p_studio_id: params.studioId,
          p_appointment_id: payload.appointment_id,
          p_settlement_mode: "package_credit",
          p_required_amount: servicePrice,
          p_currency: serviceCurrency,
          p_client_package_id: consumePayload.client_package_id,
          p_consume_ledger_entry_id: consumePayload.ledger_entry_id,
          p_metadata: {
            eligibility_rule: "conservative_studio_location_expiry_balance",
            service_level_mapping: "not_configured_phase2",
          },
        });
        if (settlement.error) {
          const mapped = mapRpcError(settlement.error);
          return { ok: false, ...mapped };
        }

        return {
          ok: true,
          payload: {
            appointmentId: payload.appointment_id,
            status: payload.status,
            startsAt: payload.starts_at,
            endsAt: payload.ends_at,
            settlementStatus: "package_consumed",
            paymentId: null,
          },
        };
      }

      if (params.settlementOption === "online_deposit" || params.settlementOption === "online_full") {
        try {
          const online = await createSelfAppointmentOnlinePayment({
            userId: params.userId,
            studioId: params.studioId,
            studioSlug: params.studioSlug,
            appointmentId: payload.appointment_id,
            salonCustomerId: appointmentSnapshot.salon_customer_id,
            locationId: appointmentSnapshot.location_id,
            serviceId: appointmentSnapshot.service_id,
            employeeId: appointmentSnapshot.employee_id,
            serviceTitleSnapshot: appointmentSnapshot.service_title_snapshot,
            servicePriceSnapshot: servicePrice,
            serviceCurrencySnapshot: serviceCurrency,
            settlementOption: params.settlementOption,
          });

          const settlement = await admin.rpc("apt04_upsert_appointment_settlement", {
            p_actor_id: params.userId,
            p_studio_id: params.studioId,
            p_appointment_id: payload.appointment_id,
            p_settlement_mode: params.settlementOption,
            p_required_amount: servicePrice,
            p_currency: serviceCurrency,
            p_payment_id: online.paymentId,
            p_pos_sale_id: online.posSaleId,
            p_expires_at: online.expiresAtIso,
            p_metadata: {
              expected_payment_amount: online.expectedAmount,
              eligibility_rule: "server_price_snapshot",
            },
          });
          if (settlement.error) {
            const mapped = mapRpcError(settlement.error);
            return { ok: false, ...mapped };
          }

          return {
            ok: true,
            payload: {
              appointmentId: payload.appointment_id,
              status: payload.status,
              startsAt: payload.starts_at,
              endsAt: payload.ends_at,
              settlementStatus: "pending_payment",
              paymentId: online.paymentId,
            },
          };
        } catch (onlineError) {
          await admin.rpc("cancel_salon_appointment", {
            p_actor_id: params.userId,
            p_actor_role: "customer",
            p_studio_id: params.studioId,
            p_appointment_id: payload.appointment_id,
            p_reason: "payment_request_create_failed",
          });
          const msg = onlineError instanceof Error ? onlineError.message : "payment_create_failed";
          if (msg.includes("payment_config_missing")) {
            return { ok: false, code: "payment_config_missing", message: "Online payment is not configured for this studio." };
          }
          return { ok: false, code: "payment_create_failed", message: msg };
        }
      }

      const settlement = await admin.rpc("apt04_upsert_appointment_settlement", {
        p_actor_id: params.userId,
        p_studio_id: params.studioId,
        p_appointment_id: payload.appointment_id,
        p_settlement_mode: "free",
        p_required_amount: servicePrice,
        p_currency: serviceCurrency,
        p_metadata: {
          eligibility_rule: "phase1_compatible_no_payment",
        },
      });
      if (settlement.error) {
        const mapped = mapRpcError(settlement.error);
        return { ok: false, ...mapped };
      }

      return {
        ok: true,
        payload: {
          appointmentId: payload.appointment_id,
          status: payload.status,
          startsAt: payload.starts_at,
          endsAt: payload.ends_at,
          settlementStatus: "no_payment_required",
          paymentId: null,
        },
      };
    },
  });
}

export async function rescheduleSelfAppointment(params: {
  userId: string;
  studioId: string;
  appointmentId: string;
  newStartsAtIso: string;
  reason: string;
  idempotencyKey: string;
}): Promise<AppointmentMutationResult<{ appointmentId: string; status: string; startsAt: string; endsAt: string }>> {
  const customer = await resolveSelfSalonCustomer({ studioId: params.studioId, userId: params.userId });
  if (!customer.ok) {
    return { ok: false, code: "forbidden", message: "Customer account is not linked to this studio." };
  }

  const admin = createAdminClient();
  const { data: appointment, error: appointmentError } = await admin
    .from("salon_appointments")
    .select("id, salon_customer_id")
    .eq("id", params.appointmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; salon_customer_id: string }>();
  if (appointmentError) throw appointmentError;
  if (!appointment?.id || appointment.salon_customer_id !== customer.salonCustomerId) {
    return { ok: false, code: "forbidden", message: "Appointment is outside your account scope." };
  }

  const { data: activeResources, error: resourceError } = await admin
    .from("salon_appointment_resources")
    .select("resource_id")
    .eq("appointment_id", params.appointmentId)
    .eq("is_active", true);
  if (resourceError) throw resourceError;

  return withSelfAppointmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_appointment:reschedule",
    idempotencyKey: params.idempotencyKey,
    requestPayload: params,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const { data, error } = await admin.rpc("reschedule_salon_appointment", {
        p_actor_id: params.userId,
        p_actor_role: "customer",
        p_studio_id: params.studioId,
        p_appointment_id: params.appointmentId,
        p_new_starts_at: params.newStartsAtIso,
        p_new_resource_ids: (activeResources ?? []).map((row) => row.resource_id),
        p_reason: params.reason,
        p_idempotency_key_id: idempotencyRecordId,
        p_idempotency_claim_token: claimToken,
      });
      if (error) {
        const mapped = mapRpcError(error);
        return { ok: false, ...mapped };
      }

      const payload = data as { appointment_id: string; status: string; starts_at: string; ends_at: string };
      return {
        ok: true,
        payload: {
          appointmentId: payload.appointment_id,
          status: payload.status,
          startsAt: payload.starts_at,
          endsAt: payload.ends_at,
        },
      };
    },
  });
}

export async function cancelSelfAppointment(params: {
  userId: string;
  studioId: string;
  appointmentId: string;
  reason: string;
  idempotencyKey: string;
}): Promise<AppointmentMutationResult<{ appointmentId: string; status: string; alreadyCancelled: boolean }>> {
  const customer = await resolveSelfSalonCustomer({ studioId: params.studioId, userId: params.userId });
  if (!customer.ok) {
    return { ok: false, code: "forbidden", message: "Customer account is not linked to this studio." };
  }

  const admin = createAdminClient();
  const { data: appointment, error: appointmentError } = await admin
    .from("salon_appointments")
    .select("id, salon_customer_id")
    .eq("id", params.appointmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; salon_customer_id: string }>();
  if (appointmentError) throw appointmentError;
  if (!appointment?.id || appointment.salon_customer_id !== customer.salonCustomerId) {
    return { ok: false, code: "forbidden", message: "Appointment is outside your account scope." };
  }

  return withSelfAppointmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_appointment:cancel",
    idempotencyKey: params.idempotencyKey,
    requestPayload: params,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const { data, error } = await admin.rpc("cancel_salon_appointment", {
        p_actor_id: params.userId,
        p_actor_role: "customer",
        p_studio_id: params.studioId,
        p_appointment_id: params.appointmentId,
        p_reason: params.reason,
        p_idempotency_key_id: idempotencyRecordId,
        p_idempotency_claim_token: claimToken,
      });
      if (error) {
        const mapped = mapRpcError(error);
        return { ok: false, ...mapped };
      }

      const payload = data as {
        appointment_id: string;
        status: string;
        already_cancelled: boolean;
      };
      return {
        ok: true,
        payload: {
          appointmentId: payload.appointment_id,
          status: payload.status,
          alreadyCancelled: Boolean(payload.already_cancelled),
        },
      };
    },
  });
}

export async function getLatestSalonTermsVersion(params: { studioId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("salon_terms_versions")
    .select("id, version_label, content_snapshot, content_hash, published_at")
    .eq("studio_id", params.studioId)
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      version_label: string | null;
      content_snapshot: unknown;
      content_hash: string;
      published_at: string;
    }>();
  if (error) throw error;
  return data;
}

export function parseRescheduleDatetime(raw: string) {
  return parseDatetimeLocalAsSgt(raw);
}

export function isSameSgtDate(iso: string, dateYmd: string) {
  const parts = toSgtDateParts(iso);
  return parts?.ymd === dateYmd;
}

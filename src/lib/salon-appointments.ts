import "server-only";

import {
  claimIdempotencyKey,
  failIdempotencyKey,
  hashIdempotencyRequest,
  type IdempotencyClaimResult,
} from "@/lib/idempotency";
import {
  requireStaffMutationScope,
  requireStaffScope,
  type StaffScopeFailureReason,
} from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

const APPOINTMENT_MUTATION_ROLES = ["owner", "manager", "frontdesk"] as const;
const APPOINTMENT_READ_ROLES = ["owner", "manager", "frontdesk"] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

export type AppointmentConflictCode =
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
  | "unknown";

export type AppointmentMutationResult<TPayload> =
  | { ok: true; payload: TPayload }
  | {
      ok: false;
      code: AppointmentConflictCode;
      message: string;
      detail?: string;
    };

export type AppointmentRecord = {
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
  cancellation_actor_id: string | null;
  cancellation_actor_role: string | null;
  cancelled_at: string | null;
  service_title_snapshot: string;
  service_price_snapshot: number;
  service_currency_snapshot: string;
  service_duration_snapshot_minutes: number;
  prep_snapshot_minutes: number;
  buffer_snapshot_minutes: number;
  employee_name_snapshot: string;
  location_name_snapshot: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const APPOINTMENT_SAFE_SELECT = [
  "id",
  "studio_id",
  "location_id",
  "salon_customer_id",
  "service_id",
  "employee_id",
  "status",
  "starts_at",
  "ends_at",
  "occupied_from",
  "occupied_until",
  "expires_at",
  "cancellation_reason",
  "cancellation_actor_id",
  "cancellation_actor_role",
  "cancelled_at",
  "service_title_snapshot",
  "service_price_snapshot",
  "service_currency_snapshot",
  "service_duration_snapshot_minutes",
  "prep_snapshot_minutes",
  "buffer_snapshot_minutes",
  "employee_name_snapshot",
  "location_name_snapshot",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
].join(", ");

export type CreateAppointmentParams = {
  userId: string;
  studioId: string;
  locationId: string;
  salonCustomerId: string;
  serviceId: string;
  employeeId: string;
  startsAtIso: string;
  resourceIds?: string[];
  termsVersionId?: string | null;
  termsAcceptedAtIso?: string | null;
  termsAcceptanceChannel?: string | null;
  termsAcceptanceMethod?: string | null;
  termsRecordedBy?: string | null;
  expiresAtIso?: string | null;
  internalNote?: string | null;
  idempotencyKey: string;
};

export type RescheduleAppointmentParams = {
  userId: string;
  studioId: string;
  appointmentId: string;
  newStartsAtIso: string;
  newResourceIds?: string[];
  reason?: string | null;
  newLocationId?: string | null;
  newServiceId?: string | null;
  newEmployeeId?: string | null;
  newExpiresAtIso?: string | null;
  idempotencyKey: string;
};

export type CancelAppointmentParams = {
  userId: string;
  studioId: string;
  appointmentId: string;
  reason: string;
  idempotencyKey: string;
};

function mapScopeFailure(reason: StaffScopeFailureReason): AppointmentConflictCode {
  if (reason === "studio_not_found") return "studio_not_found";
  if (reason === "studio_suspended") return "studio_suspended";
  return "forbidden";
}

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

function assertMutationInputIds(params: Record<string, string | null | undefined>) {
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (!isUuid(value)) {
      return {
        ok: false as const,
        code: "invalid_request" as AppointmentConflictCode,
        message: `Invalid UUID for ${key}.`,
      };
    }
  }
  return { ok: true as const };
}

function parseIdempotencyClaim(
  claim: IdempotencyClaimResult,
): { continue: true; claimId: string; claimToken: string } | AppointmentMutationResult<never> {
  if (claim.ok && claim.outcome === "claimed") {
    return {
      continue: true,
      claimId: claim.id,
      claimToken: claim.claimToken,
    };
  }

  if (claim.ok && claim.outcome === "already_completed") {
    return {
      ok: true,
      payload: (claim.result ?? null) as never,
    };
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

function normalizeCreateOrReschedulePayload(snapshot: unknown):
  | { appointmentId: string; status: string; startsAt: string; endsAt: string }
  | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  const appointmentId = (record.appointmentId ?? record.appointment_id) as string | undefined;
  const status = record.status as string | undefined;
  const startsAt = (record.startsAt ?? record.starts_at) as string | undefined;
  const endsAt = (record.endsAt ?? record.ends_at) as string | undefined;
  if (!appointmentId || !status || !startsAt || !endsAt) return null;
  return { appointmentId, status, startsAt, endsAt };
}

function normalizeCancelPayload(snapshot: unknown):
  | { appointmentId: string; status: string; alreadyCancelled: boolean }
  | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  const appointmentId = (record.appointmentId ?? record.appointment_id) as string | undefined;
  const status = record.status as string | undefined;
  const alreadyCancelledRaw =
    (record.alreadyCancelled ?? record.already_cancelled) as boolean | string | undefined;
  if (!appointmentId || !status || alreadyCancelledRaw == null) return null;
  const alreadyCancelled =
    typeof alreadyCancelledRaw === "boolean"
      ? alreadyCancelledRaw
      : alreadyCancelledRaw === "true";
  return { appointmentId, status, alreadyCancelled };
}

async function withAppointmentIdempotency<TPayload>(params: {
  studioId: string;
  operationScope: string;
  idempotencyKey: string;
  requestPayload: unknown;
  normalizeReplayPayload: (snapshot: unknown) => TPayload | null;
  run: (ctx: { idempotencyRecordId: string; claimToken: string }) => Promise<AppointmentMutationResult<TPayload>>;
}): Promise<AppointmentMutationResult<TPayload>> {
  const requestHash = hashIdempotencyRequest(params.requestPayload);
  const claim = await claimIdempotencyKey({
    studioId: params.studioId,
    operationScope: params.operationScope,
    idempotencyKey: params.idempotencyKey,
    requestHash,
  });

  const parsed = parseIdempotencyClaim(claim);
  if (!("continue" in parsed)) {
    if (parsed.ok) {
      const normalized = params.normalizeReplayPayload(parsed.payload);
      if (!normalized) {
        return {
          ok: false,
          code: "unknown",
          message: "Stored idempotency result is malformed for this operation.",
        };
      }
      return { ok: true, payload: normalized };
    }
    return parsed as AppointmentMutationResult<TPayload>;
  }

  const result = await params.run({
    idempotencyRecordId: parsed.claimId,
    claimToken: parsed.claimToken,
  });

  if (!result.ok) {
    const failed = await failIdempotencyKey({
      recordId: parsed.claimId,
      claimToken: parsed.claimToken,
      errorSummary: `${result.code}: ${result.message}`,
      retryable: true,
    });
    if (!failed.ok) {
      return {
        ok: false,
        code: "idempotency_stale_claim",
        message: "Idempotency claim token is stale and cannot be failed.",
      };
    }
  }

  return result;
}

export async function createAppointment(
  params: CreateAppointmentParams,
): Promise<AppointmentMutationResult<{ appointmentId: string; status: string; startsAt: string; endsAt: string }>> {
  const idValidation = assertMutationInputIds({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    salonCustomerId: params.salonCustomerId,
    serviceId: params.serviceId,
    employeeId: params.employeeId,
    termsVersionId: params.termsVersionId ?? null,
    termsRecordedBy: params.termsRecordedBy ?? null,
    ...Object.fromEntries((params.resourceIds ?? []).map((id, idx) => [`resourceIds[${idx}]`, id])),
  });
  if (!idValidation.ok) return idValidation;

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...APPOINTMENT_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: mapScopeFailure(scope.reason),
      message: scope.reason,
    };
  }

  return withAppointmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_appointment:create",
    idempotencyKey: params.idempotencyKey,
    requestPayload: params,
    normalizeReplayPayload: normalizeCreateOrReschedulePayload,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("create_salon_appointment", {
        p_actor_id: params.userId,
        p_actor_role: scope.role,
        p_studio_id: params.studioId,
        p_location_id: params.locationId,
        p_salon_customer_id: params.salonCustomerId,
        p_service_id: params.serviceId,
        p_employee_id: params.employeeId,
        p_starts_at: params.startsAtIso,
        p_resource_ids: params.resourceIds ?? null,
        p_terms_version_id: params.termsVersionId ?? null,
        p_terms_accepted_at: params.termsAcceptedAtIso ?? null,
        p_terms_acceptance_channel: params.termsAcceptanceChannel ?? null,
        p_terms_acceptance_method: params.termsAcceptanceMethod ?? null,
        p_terms_recorded_by: params.termsRecordedBy ?? null,
        p_expires_at: params.expiresAtIso ?? null,
        p_internal_note: params.internalNote ?? null,
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
        starts_at: string;
        ends_at: string;
      };

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

export async function rescheduleAppointment(
  params: RescheduleAppointmentParams,
): Promise<AppointmentMutationResult<{ appointmentId: string; status: string; startsAt: string; endsAt: string }>> {
  const idValidation = assertMutationInputIds({
    userId: params.userId,
    studioId: params.studioId,
    appointmentId: params.appointmentId,
    newLocationId: params.newLocationId ?? null,
    newServiceId: params.newServiceId ?? null,
    newEmployeeId: params.newEmployeeId ?? null,
    ...Object.fromEntries((params.newResourceIds ?? []).map((id, idx) => [`newResourceIds[${idx}]`, id])),
  });
  if (!idValidation.ok) return idValidation;

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("salon_appointments")
    .select("id, location_id")
    .eq("id", params.appointmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; location_id: string }>();

  if (existingError) throw existingError;
  if (!existing) {
    return {
      ok: false,
      code: "not_found",
      message: "Appointment not found.",
    };
  }

  const scope = await requireStaffMutationScope({
    userId: params.userId,
    studioId: params.studioId,
    currentLocationId: existing.location_id,
    targetLocationId: params.newLocationId ?? existing.location_id,
    roles: [...APPOINTMENT_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: mapScopeFailure(scope.reason),
      message: scope.reason,
    };
  }

  return withAppointmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_appointment:reschedule",
    idempotencyKey: params.idempotencyKey,
    requestPayload: params,
    normalizeReplayPayload: normalizeCreateOrReschedulePayload,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const { data, error } = await admin.rpc("reschedule_salon_appointment", {
        p_actor_id: params.userId,
        p_actor_role: scope.role,
        p_studio_id: params.studioId,
        p_appointment_id: params.appointmentId,
        p_new_starts_at: params.newStartsAtIso,
        p_new_resource_ids: params.newResourceIds ?? null,
        p_reason: params.reason ?? null,
        p_new_location_id: params.newLocationId ?? null,
        p_new_service_id: params.newServiceId ?? null,
        p_new_employee_id: params.newEmployeeId ?? null,
        p_new_expires_at: params.newExpiresAtIso ?? null,
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
        starts_at: string;
        ends_at: string;
      };

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

export async function cancelAppointment(
  params: CancelAppointmentParams,
): Promise<AppointmentMutationResult<{ appointmentId: string; status: string; alreadyCancelled: boolean }>> {
  const idValidation = assertMutationInputIds({
    userId: params.userId,
    studioId: params.studioId,
    appointmentId: params.appointmentId,
  });
  if (!idValidation.ok) return idValidation;

  if (!params.reason || params.reason.trim().length === 0) {
    return {
      ok: false,
      code: "invalid_request",
      message: "Cancellation reason is required.",
    };
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("salon_appointments")
    .select("id, location_id")
    .eq("id", params.appointmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; location_id: string }>();

  if (existingError) throw existingError;
  if (!existing) {
    return {
      ok: false,
      code: "not_found",
      message: "Appointment not found.",
    };
  }

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: existing.location_id,
    roles: [...APPOINTMENT_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: mapScopeFailure(scope.reason),
      message: scope.reason,
    };
  }

  return withAppointmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_appointment:cancel",
    idempotencyKey: params.idempotencyKey,
    requestPayload: params,
    normalizeReplayPayload: normalizeCancelPayload,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const { data, error } = await admin.rpc("cancel_salon_appointment", {
        p_actor_id: params.userId,
        p_actor_role: scope.role,
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

export async function expirePendingAppointments(params?: {
  limit?: number;
}): Promise<AppointmentMutationResult<{ expiredCount: number }>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("expire_pending_salon_appointments", {
    p_limit: params?.limit ?? 200,
  });

  if (error) {
    const mapped = mapRpcError(error);
    return { ok: false, ...mapped };
  }

  return {
    ok: true,
    payload: { expiredCount: Number(data ?? 0) },
  };
}

export async function getAppointmentById(params: {
  userId: string;
  studioId: string;
  appointmentId: string;
}): Promise<AppointmentMutationResult<{ appointment: AppointmentRecord }>> {
  const idValidation = assertMutationInputIds({
    userId: params.userId,
    studioId: params.studioId,
    appointmentId: params.appointmentId,
  });
  if (!idValidation.ok) return idValidation;

  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin
    .from("salon_appointments")
    .select(APPOINTMENT_SAFE_SELECT)
    .eq("id", params.appointmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<AppointmentRecord>();

  if (rowError) throw rowError;
  if (!row) {
    return {
      ok: false,
      code: "not_found",
      message: "Appointment not found.",
    };
  }

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: row.location_id,
    roles: [...APPOINTMENT_READ_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: mapScopeFailure(scope.reason),
      message: scope.reason,
    };
  }

  return {
    ok: true,
    payload: { appointment: row },
  };
}

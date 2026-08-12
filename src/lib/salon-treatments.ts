import "server-only";

import {
  claimIdempotencyKey,
  failIdempotencyKey,
  hashIdempotencyRequest,
  type IdempotencyClaimResult,
} from "@/lib/idempotency";
import { buildAccessContext, type StaffRole } from "@/lib/rbac";
import {
  canMutateTreatmentInScopedLocation,
  deriveAllowedTreatmentIdsByScopedLocationRole,
  type TreatmentScopedRole,
} from "@/lib/salon-treatment-rules";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TREATMENT_MUTATION_ROLES = ["owner", "manager", "frontdesk", "instructor"] as const;

type TreatmentMutationRole = (typeof TREATMENT_MUTATION_ROLES)[number];

function isUuid(value: string | null | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function roleRank(role: TreatmentMutationRole) {
  if (role === "owner") return 4;
  if (role === "manager") return 3;
  if (role === "frontdesk") return 2;
  return 1;
}

function pickHigherRole(current: TreatmentMutationRole | null, candidate: TreatmentMutationRole | null) {
  if (!candidate) return current;
  if (!current) return candidate;
  return roleRank(candidate) > roleRank(current) ? candidate : current;
}

function normalizeStaffRole(role: StaffRole): TreatmentMutationRole {
  if (role === "owner" || role === "manager" || role === "frontdesk") return role;
  return "instructor";
}

export type TreatmentErrorCode =
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "idempotency_permanently_failed"
  | "idempotency_stale_claim"
  | "scope_violation"
  | "unknown";

export type TreatmentMutationResult<TPayload> =
  | { ok: true; payload: TPayload }
  | { ok: false; code: TreatmentErrorCode; message: string };

export type TreatmentLifecycleStatus = "open" | "completed" | "archived";
export type TreatmentFollowUpStatus = "pending" | "in_progress" | "done" | "cancelled";

export type SalonTreatment = {
  id: string;
  studio_id: string;
  location_id: string;
  salon_customer_id: string;
  appointment_id: string;
  service_id: string;
  actual_employee_id: string;
  service_title_snapshot: string;
  service_duration_snapshot_minutes: number;
  service_price_snapshot: number;
  service_currency_snapshot: string;
  actual_employee_name_snapshot: string;
  lifecycle_status: TreatmentLifecycleStatus;
  latest_revision_no: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SalonTreatmentRevision = {
  id: string;
  treatment_id: string;
  studio_id: string;
  revision_no: number;
  lifecycle_status: TreatmentLifecycleStatus;
  revision_reason: string | null;
  note_summary: string | null;
  sensitive_note_body: string | null;
  created_by: string | null;
  created_role: string | null;
  created_at: string;
};

export type SalonTreatmentFollowUp = {
  id: string;
  treatment_id: string;
  studio_id: string;
  location_id: string;
  salon_customer_id: string;
  due_on: string;
  owner_employee_id: string | null;
  owner_name_snapshot: string | null;
  status: TreatmentFollowUpStatus;
  note_summary: string | null;
  completed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerTreatmentDetail = {
  treatment: SalonTreatment;
  latestRevision: SalonTreatmentRevision | null;
  followUps: SalonTreatmentFollowUp[];
};

export type FollowUpQueueItem = SalonTreatmentFollowUp & {
  treatment: Pick<SalonTreatment, "id" | "appointment_id" | "service_title_snapshot" | "actual_employee_name_snapshot">;
};

type ResolvedTreatmentActor = {
  studioId: string;
  userId: string;
  actorEmployeeIds: string[];
  allowedLocationIds: string[];
  hasGlobalOwnerScope: boolean;
  hasGlobalManagerScope: boolean;
  effectiveRoleByLocationId: Record<string, TreatmentMutationRole>;
  scopedRoleByLocationId: Record<string, TreatmentScopedRole>;
};

function mapRpcError(error: { code?: string; message?: string }) {
  const message = error.message ?? "Unknown treatment error";

  if (!error.code) return { code: "unknown" as const, message };
  switch (error.code) {
    case "P0002":
      return { code: "not_found" as const, message };
    case "42501":
      return { code: "forbidden" as const, message };
    case "22023":
      return { code: "invalid_request" as const, message };
    case "23514":
      if (/idempotency|claim token|not current/i.test(message)) {
        return { code: "idempotency_stale_claim" as const, message };
      }
      if (/scope|location|studio|instructor/i.test(message)) {
        return { code: "scope_violation" as const, message };
      }
      return { code: "invalid_request" as const, message };
    default:
      return { code: "unknown" as const, message };
  }
}

function parseIdempotencyClaim(
  claim: IdempotencyClaimResult,
): { continue: true; claimId: string; claimToken: string } | TreatmentMutationResult<never> {
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
      message: "Another request with this idempotency key is in progress.",
    };
  }
  if (!claim.ok && claim.outcome === "hash_conflict") {
    return {
      ok: false,
      code: "idempotency_conflict",
      message: "Idempotency key reused with a different payload.",
    };
  }
  return {
    ok: false,
    code: "idempotency_permanently_failed",
    message: "Idempotency key is marked permanently failed.",
  };
}

async function listActiveEmployeeIdsForUser(params: { studioId: string; userId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select("id")
    .eq("studio_id", params.studioId)
    .eq("user_id", params.userId)
    .eq("employment_status", "active");
  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}

async function resolveTreatmentActor(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  preferredLocationId?: string | null;
}): Promise<{ ok: true; actor: ResolvedTreatmentActor } | { ok: false; reason: "forbidden" | "invalid_request" }> {
  if (!isUuid(params.userId) || !isUuid(params.studioId)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (params.preferredLocationId && !isUuid(params.preferredLocationId)) {
    return { ok: false, reason: "invalid_request" };
  }

  const ctx = await buildAccessContext(params.userId, params.email ?? null, params.preferredLocationId ?? null);
  const studioMemberships = ctx.memberships.filter(
    (membership) =>
      membership.studio_id === params.studioId &&
      TREATMENT_MUTATION_ROLES.includes(membership.role as TreatmentMutationRole),
  );

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("owner_id")
    .eq("id", params.studioId)
    .maybeSingle<{ owner_id: string | null }>();

  const isOwner = studio?.owner_id === params.userId
    || studioMemberships.some((membership) => membership.role === "owner" && membership.location_id == null);

  if (!isOwner && !studioMemberships.length) {
    return { ok: false, reason: "forbidden" };
  }

  const hasGlobalManagerScope = studioMemberships.some(
    (membership) => membership.role === "manager" && membership.location_id == null,
  );

  const globalRoleFromMemberships = studioMemberships
    .filter((membership) => membership.location_id == null)
    .map((membership) => normalizeStaffRole(membership.role));

  let globalRole: TreatmentMutationRole | null = null;
  for (const role of globalRoleFromMemberships) {
    globalRole = pickHigherRole(globalRole, role);
  }
  if (isOwner) globalRole = "owner";

  const localRoleByLocation = new Map<string, TreatmentMutationRole>();
  for (const membership of studioMemberships) {
    if (!membership.location_id) continue;
    const role = normalizeStaffRole(membership.role);
    const current = localRoleByLocation.get(membership.location_id) ?? null;
    localRoleByLocation.set(membership.location_id, pickHigherRole(current, role)!);
  }

  const allowedLocationIds = ctx.locations
    .filter((location) => location.studio_id === params.studioId)
    .map((location) => location.id);

  const effectiveRoleByLocationId: Record<string, TreatmentMutationRole> = {};
  const scopedRoleByLocationId: Record<string, TreatmentScopedRole> = {};
  for (const locationId of allowedLocationIds) {
    const effectiveRole = pickHigherRole(globalRole, localRoleByLocation.get(locationId) ?? null);
    if (!effectiveRole) continue;
    effectiveRoleByLocationId[locationId] = effectiveRole;
    scopedRoleByLocationId[locationId] = effectiveRole === "instructor" ? "instructor" : "non_instructor";
  }

  const actorEmployeeIds = await listActiveEmployeeIdsForUser({ studioId: params.studioId, userId: params.userId });

  return {
    ok: true,
    actor: {
      studioId: params.studioId,
      userId: params.userId,
      actorEmployeeIds,
      allowedLocationIds,
      hasGlobalOwnerScope: isOwner,
      hasGlobalManagerScope,
      effectiveRoleByLocationId,
      scopedRoleByLocationId,
    },
  };
}

function normalizeCreatePayload(snapshot: unknown):
  | { treatmentId: string; alreadyLinked: boolean; followUpId: string | null }
  | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  const treatmentId = (record.treatmentId ?? record.treatment_id) as string | undefined;
  const followUpId = (record.followUpId ?? record.follow_up_id) as string | null | undefined;
  const alreadyLinkedRaw = (record.alreadyLinked ?? record.already_linked) as boolean | string | undefined;
  if (!treatmentId || alreadyLinkedRaw == null) return null;
  return {
    treatmentId,
    alreadyLinked: typeof alreadyLinkedRaw === "boolean" ? alreadyLinkedRaw : alreadyLinkedRaw === "true",
    followUpId: followUpId ?? null,
  };
}

function normalizeRevisionPayload(snapshot: unknown):
  | { treatmentId: string; revisionId: string; revisionNo: number; lifecycleStatus: TreatmentLifecycleStatus }
  | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  const treatmentId = (record.treatmentId ?? record.treatment_id) as string | undefined;
  const revisionId = (record.revisionId ?? record.revision_id) as string | undefined;
  const revisionNoRaw = (record.revisionNo ?? record.revision_no) as number | string | undefined;
  const lifecycleStatus = (record.lifecycleStatus ?? record.lifecycle_status) as TreatmentLifecycleStatus | undefined;
  const revisionNo = typeof revisionNoRaw === "number" ? revisionNoRaw : Number(revisionNoRaw ?? "NaN");
  if (!treatmentId || !revisionId || !lifecycleStatus || !Number.isFinite(revisionNo)) return null;
  return { treatmentId, revisionId, revisionNo, lifecycleStatus };
}

function normalizeFollowUpPayload(snapshot: unknown):
  | { followUpId: string; treatmentId: string; status: TreatmentFollowUpStatus; dueOn: string }
  | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  const followUpId = (record.followUpId ?? record.follow_up_id) as string | undefined;
  const treatmentId = (record.treatmentId ?? record.treatment_id) as string | undefined;
  const status = record.status as TreatmentFollowUpStatus | undefined;
  const dueOn = (record.dueOn ?? record.due_on) as string | undefined;
  if (!followUpId || !treatmentId || !status || !dueOn) return null;
  return { followUpId, treatmentId, status, dueOn };
}

async function withTreatmentIdempotency<TPayload>(params: {
  studioId: string;
  operationScope: string;
  idempotencyKey: string;
  requestPayload: unknown;
  normalizeReplayPayload: (snapshot: unknown) => TPayload | null;
  run: (ctx: { idempotencyRecordId: string; claimToken: string }) => Promise<TreatmentMutationResult<TPayload>>;
}): Promise<TreatmentMutationResult<TPayload>> {
  const claim = await claimIdempotencyKey({
    studioId: params.studioId,
    operationScope: params.operationScope,
    idempotencyKey: params.idempotencyKey,
    requestHash: hashIdempotencyRequest(params.requestPayload),
  });

  const parsed = parseIdempotencyClaim(claim);
  if (!("continue" in parsed)) {
    if (parsed.ok) {
      const payload = params.normalizeReplayPayload(parsed.payload);
      if (!payload) {
        return { ok: false, code: "unknown", message: "Malformed idempotency replay payload." };
      }
      return { ok: true, payload };
    }
    return parsed as TreatmentMutationResult<TPayload>;
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
      return { ok: false, code: "idempotency_stale_claim", message: "Idempotency claim token is stale." };
    }
  }

  return result;
}

function resolveActorRoleForLocation(params: {
  actor: ResolvedTreatmentActor;
  locationId: string;
}): TreatmentMutationRole | null {
  if (params.actor.hasGlobalOwnerScope) return "owner";
  if (params.actor.hasGlobalManagerScope) return "manager";
  return params.actor.effectiveRoleByLocationId[params.locationId] ?? null;
}

export async function createOrLinkTreatmentFromCompletedAppointment(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  appointmentId: string;
  actualEmployeeId?: string | null;
  lifecycleStatus?: TreatmentLifecycleStatus;
  revisionReason?: string | null;
  noteSummary?: string | null;
  sensitiveNoteBody?: string | null;
  followUpDueOn?: string | null;
  followUpOwnerEmployeeId?: string | null;
  followUpNoteSummary?: string | null;
  idempotencyKey: string;
}): Promise<TreatmentMutationResult<{ treatmentId: string; alreadyLinked: boolean; followUpId: string | null }>> {
  if (!isUuid(params.userId) || !isUuid(params.studioId) || !isUuid(params.appointmentId)) {
    return { ok: false, code: "invalid_request", message: "Invalid UUID input." };
  }
  if (params.actualEmployeeId && !isUuid(params.actualEmployeeId)) {
    return { ok: false, code: "invalid_request", message: "Invalid actual employee UUID." };
  }
  if (params.followUpOwnerEmployeeId && !isUuid(params.followUpOwnerEmployeeId)) {
    return { ok: false, code: "invalid_request", message: "Invalid follow-up owner UUID." };
  }
  if (!params.idempotencyKey.trim()) {
    return { ok: false, code: "invalid_request", message: "idempotency_key_required" };
  }

  const admin = createAdminClient();
  const { data: appointment, error: appointmentError } = await admin
    .from("salon_appointments")
    .select("id, studio_id, location_id, employee_id, status")
    .eq("id", params.appointmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; studio_id: string; location_id: string; employee_id: string; status: string }>();

  if (appointmentError) throw appointmentError;
  if (!appointment) return { ok: false, code: "not_found", message: "Appointment not found." };

  const actorResult = await resolveTreatmentActor({
    userId: params.userId,
    email: params.email ?? null,
    studioId: params.studioId,
    preferredLocationId: appointment.location_id,
  });
  if (!actorResult.ok) {
    return { ok: false, code: actorResult.reason, message: actorResult.reason };
  }

  const actor = actorResult.actor;
  const scopedRole = actor.scopedRoleByLocationId[appointment.location_id] ?? null;
  const servedByActor = actor.actorEmployeeIds.includes(appointment.employee_id);
  if (!(actor.hasGlobalOwnerScope || actor.hasGlobalManagerScope)
    && !canMutateTreatmentInScopedLocation({ scopedRole, servedByActor })) {
    return {
      ok: false,
      code: "forbidden",
      message: "You do not have permission to create treatment for this appointment.",
    };
  }

  const actorRole = resolveActorRoleForLocation({ actor, locationId: appointment.location_id });
  if (!actorRole) {
    return { ok: false, code: "forbidden", message: "forbidden" };
  }

  return withTreatmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_treatment:create_from_appointment",
    idempotencyKey: params.idempotencyKey,
    requestPayload: {
      appointmentId: params.appointmentId,
      actualEmployeeId: params.actualEmployeeId ?? null,
      lifecycleStatus: params.lifecycleStatus ?? "open",
      revisionReason: normalizeText(params.revisionReason) ?? null,
      noteSummary: normalizeText(params.noteSummary) ?? null,
      sensitiveNoteBody: params.sensitiveNoteBody ?? null,
      followUpDueOn: params.followUpDueOn ?? null,
      followUpOwnerEmployeeId: params.followUpOwnerEmployeeId ?? null,
      followUpNoteSummary: normalizeText(params.followUpNoteSummary) ?? null,
    },
    normalizeReplayPayload: normalizeCreatePayload,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const { data, error } = await admin.rpc("crm02_create_or_link_treatment_from_appointment", {
        p_actor_id: params.userId,
        p_actor_role: actorRole,
        p_actor_employee_id: actorRole === "instructor" ? appointment.employee_id : null,
        p_studio_id: params.studioId,
        p_appointment_id: params.appointmentId,
        p_actual_employee_id: params.actualEmployeeId ?? null,
        p_lifecycle_status: params.lifecycleStatus ?? "open",
        p_revision_reason: normalizeText(params.revisionReason),
        p_note_summary: normalizeText(params.noteSummary),
        p_sensitive_note_body: params.sensitiveNoteBody ?? null,
        p_follow_up_due_on: params.followUpDueOn ?? null,
        p_follow_up_owner_employee_id: params.followUpOwnerEmployeeId ?? null,
        p_follow_up_note_summary: normalizeText(params.followUpNoteSummary),
        p_idempotency_key_id: idempotencyRecordId,
        p_idempotency_claim_token: claimToken,
      });

      if (error) {
        const mapped = mapRpcError(error);
        return { ok: false, ...mapped };
      }

      const payload = normalizeCreatePayload(data);
      if (!payload) {
        return { ok: false, code: "unknown", message: "Malformed treatment creation response." };
      }

      return { ok: true, payload };
    },
  });
}

export async function reviseTreatment(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  treatmentId: string;
  lifecycleStatus: TreatmentLifecycleStatus;
  revisionReason?: string | null;
  noteSummary?: string | null;
  sensitiveNoteBody?: string | null;
  idempotencyKey: string;
}): Promise<TreatmentMutationResult<{ treatmentId: string; revisionId: string; revisionNo: number; lifecycleStatus: TreatmentLifecycleStatus }>> {
  if (!isUuid(params.userId) || !isUuid(params.studioId) || !isUuid(params.treatmentId)) {
    return { ok: false, code: "invalid_request", message: "Invalid UUID input." };
  }
  if (!params.idempotencyKey.trim()) {
    return { ok: false, code: "invalid_request", message: "idempotency_key_required" };
  }

  const admin = createAdminClient();
  const { data: treatment, error: treatmentError } = await admin
    .from("salon_treatments")
    .select("id, location_id, actual_employee_id")
    .eq("id", params.treatmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; location_id: string; actual_employee_id: string }>();
  if (treatmentError) throw treatmentError;
  if (!treatment) return { ok: false, code: "not_found", message: "Treatment not found." };

  const actorResult = await resolveTreatmentActor({
    userId: params.userId,
    email: params.email ?? null,
    studioId: params.studioId,
    preferredLocationId: treatment.location_id,
  });
  if (!actorResult.ok) return { ok: false, code: actorResult.reason, message: actorResult.reason };

  const actor = actorResult.actor;
  const actorRole = resolveActorRoleForLocation({ actor, locationId: treatment.location_id });
  if (!actorRole) return { ok: false, code: "forbidden", message: "forbidden" };

  const scopedRole = actor.scopedRoleByLocationId[treatment.location_id] ?? null;
  const servedByActor = actor.actorEmployeeIds.includes(treatment.actual_employee_id);
  if (!(actor.hasGlobalOwnerScope || actor.hasGlobalManagerScope)
    && !canMutateTreatmentInScopedLocation({ scopedRole, servedByActor })) {
    return { ok: false, code: "forbidden", message: "You cannot revise this treatment." };
  }

  return withTreatmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_treatment:revise",
    idempotencyKey: params.idempotencyKey,
    requestPayload: {
      treatmentId: params.treatmentId,
      lifecycleStatus: params.lifecycleStatus,
      revisionReason: normalizeText(params.revisionReason),
      noteSummary: normalizeText(params.noteSummary),
      sensitiveNoteBody: params.sensitiveNoteBody ?? null,
    },
    normalizeReplayPayload: normalizeRevisionPayload,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const { data, error } = await admin.rpc("crm02_revise_treatment", {
        p_actor_id: params.userId,
        p_actor_role: actorRole,
        p_actor_employee_id: actorRole === "instructor" ? treatment.actual_employee_id : null,
        p_studio_id: params.studioId,
        p_treatment_id: params.treatmentId,
        p_lifecycle_status: params.lifecycleStatus,
        p_revision_reason: normalizeText(params.revisionReason),
        p_note_summary: normalizeText(params.noteSummary),
        p_sensitive_note_body: params.sensitiveNoteBody ?? null,
        p_idempotency_key_id: idempotencyRecordId,
        p_idempotency_claim_token: claimToken,
      });

      if (error) {
        const mapped = mapRpcError(error);
        return { ok: false, ...mapped };
      }
      const payload = normalizeRevisionPayload(data);
      if (!payload) {
        return { ok: false, code: "unknown", message: "Malformed treatment revision response." };
      }
      return { ok: true, payload };
    },
  });
}

export async function upsertTreatmentFollowUp(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  treatmentId: string;
  followUpId?: string | null;
  dueOn?: string | null;
  ownerEmployeeId?: string | null;
  status?: TreatmentFollowUpStatus | null;
  noteSummary?: string | null;
  idempotencyKey: string;
}): Promise<TreatmentMutationResult<{ followUpId: string; treatmentId: string; status: TreatmentFollowUpStatus; dueOn: string }>> {
  if (!isUuid(params.userId) || !isUuid(params.studioId) || !isUuid(params.treatmentId)) {
    return { ok: false, code: "invalid_request", message: "Invalid UUID input." };
  }
  if (params.followUpId && !isUuid(params.followUpId)) {
    return { ok: false, code: "invalid_request", message: "Invalid follow-up UUID." };
  }
  if (params.ownerEmployeeId && !isUuid(params.ownerEmployeeId)) {
    return { ok: false, code: "invalid_request", message: "Invalid owner employee UUID." };
  }
  if (!params.idempotencyKey.trim()) {
    return { ok: false, code: "invalid_request", message: "idempotency_key_required" };
  }

  const admin = createAdminClient();
  const { data: treatment, error: treatmentError } = await admin
    .from("salon_treatments")
    .select("id, location_id, actual_employee_id")
    .eq("id", params.treatmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; location_id: string; actual_employee_id: string }>();
  if (treatmentError) throw treatmentError;
  if (!treatment) return { ok: false, code: "not_found", message: "Treatment not found." };

  const actorResult = await resolveTreatmentActor({
    userId: params.userId,
    email: params.email ?? null,
    studioId: params.studioId,
    preferredLocationId: treatment.location_id,
  });
  if (!actorResult.ok) return { ok: false, code: actorResult.reason, message: actorResult.reason };

  const actor = actorResult.actor;
  const actorRole = resolveActorRoleForLocation({ actor, locationId: treatment.location_id });
  if (!actorRole) return { ok: false, code: "forbidden", message: "forbidden" };

  const scopedRole = actor.scopedRoleByLocationId[treatment.location_id] ?? null;
  const servedByActor = actor.actorEmployeeIds.includes(treatment.actual_employee_id);
  if (!(actor.hasGlobalOwnerScope || actor.hasGlobalManagerScope)
    && !canMutateTreatmentInScopedLocation({ scopedRole, servedByActor })) {
    return { ok: false, code: "forbidden", message: "You cannot update follow-up for this treatment." };
  }

  return withTreatmentIdempotency({
    studioId: params.studioId,
    operationScope: "salon_treatment_follow_up:upsert",
    idempotencyKey: params.idempotencyKey,
    requestPayload: {
      treatmentId: params.treatmentId,
      followUpId: params.followUpId ?? null,
      dueOn: params.dueOn ?? null,
      ownerEmployeeId: params.ownerEmployeeId ?? null,
      status: params.status ?? null,
      noteSummary: normalizeText(params.noteSummary),
    },
    normalizeReplayPayload: normalizeFollowUpPayload,
    run: async ({ idempotencyRecordId, claimToken }) => {
      const { data, error } = await admin.rpc("crm02_upsert_treatment_follow_up", {
        p_actor_id: params.userId,
        p_actor_role: actorRole,
        p_actor_employee_id: actorRole === "instructor" ? treatment.actual_employee_id : null,
        p_studio_id: params.studioId,
        p_treatment_id: params.treatmentId,
        p_follow_up_id: params.followUpId ?? null,
        p_due_on: params.dueOn ?? null,
        p_owner_employee_id: params.ownerEmployeeId ?? null,
        p_status: params.status ?? null,
        p_note_summary: normalizeText(params.noteSummary),
        p_idempotency_key_id: idempotencyRecordId,
        p_idempotency_claim_token: claimToken,
      });

      if (error) {
        const mapped = mapRpcError(error);
        return { ok: false, ...mapped };
      }

      const payload = normalizeFollowUpPayload(data);
      if (!payload) {
        return { ok: false, code: "unknown", message: "Malformed follow-up response." };
      }
      return { ok: true, payload };
    },
  });
}

export async function listCustomerTreatments(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  customerId: string;
  locationId?: string | null;
}): Promise<
  { ok: true; rows: CustomerTreatmentDetail[] }
  | { ok: false; reason: "forbidden" | "invalid_request" | "not_found" }
> {
  if (!isUuid(params.userId) || !isUuid(params.studioId) || !isUuid(params.customerId)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (params.locationId && !isUuid(params.locationId)) {
    return { ok: false, reason: "invalid_request" };
  }

  const actorResult = await resolveTreatmentActor({
    userId: params.userId,
    email: params.email ?? null,
    studioId: params.studioId,
    preferredLocationId: params.locationId ?? null,
  });
  if (!actorResult.ok) return actorResult;

  const actor = actorResult.actor;
  const admin = createAdminClient();
  const { data: customer, error: customerError } = await admin
    .from("salon_customers")
    .select("id")
    .eq("id", params.customerId)
    .eq("studio_id", params.studioId)
    .is("merged_into_id", null)
    .maybeSingle<{ id: string }>();
  if (customerError) throw customerError;
  if (!customer) return { ok: false, reason: "not_found" };

  let query = admin
    .from("salon_treatments")
    .select("*")
    .eq("studio_id", params.studioId)
    .eq("salon_customer_id", params.customerId)
    .order("created_at", { ascending: false });

  if (params.locationId) {
    query = query.eq("location_id", params.locationId);
  }

  const { data: treatmentRows, error: treatmentError } = await query.returns<SalonTreatment[]>();
  if (treatmentError) throw treatmentError;

  const allTreatments = treatmentRows ?? [];
  if (!allTreatments.length) return { ok: true, rows: [] };

  let allowedTreatmentIds = new Set(allTreatments.map((row) => row.id));
  if (!(actor.hasGlobalOwnerScope || actor.hasGlobalManagerScope)) {
    const actorEmployeeIdSet = new Set(actor.actorEmployeeIds);
    const scoped = allTreatments.map((row) => ({
      treatment_id: row.id,
      location_id: row.location_id,
      served_by_actor: actorEmployeeIdSet.has(row.actual_employee_id),
    }));
    allowedTreatmentIds = deriveAllowedTreatmentIdsByScopedLocationRole({
      relations: scoped,
      scopedRoleByLocationId: actor.scopedRoleByLocationId,
    });
  }

  const scopedTreatments = allTreatments.filter((row) => allowedTreatmentIds.has(row.id));
  if (!scopedTreatments.length) return { ok: true, rows: [] };

  const treatmentIds = scopedTreatments.map((row) => row.id);
  const [{ data: revisions, error: revError }, { data: followUps, error: followError }] = await Promise.all([
    admin
      .from("salon_treatment_revisions")
      .select("*")
      .eq("studio_id", params.studioId)
      .in("treatment_id", treatmentIds)
      .order("revision_no", { ascending: false })
      .returns<SalonTreatmentRevision[]>(),
    admin
      .from("salon_treatment_follow_ups")
      .select("*")
      .eq("studio_id", params.studioId)
      .in("treatment_id", treatmentIds)
      .order("due_on", { ascending: true })
      .returns<SalonTreatmentFollowUp[]>(),
  ]);

  if (revError) throw revError;
  if (followError) throw followError;

  const latestRevisionByTreatmentId = new Map<string, SalonTreatmentRevision>();
  for (const revision of revisions ?? []) {
    if (!latestRevisionByTreatmentId.has(revision.treatment_id)) {
      latestRevisionByTreatmentId.set(revision.treatment_id, revision);
    }
  }

  const followUpsByTreatmentId = new Map<string, SalonTreatmentFollowUp[]>();
  for (const followUp of followUps ?? []) {
    const rows = followUpsByTreatmentId.get(followUp.treatment_id) ?? [];
    rows.push(followUp);
    followUpsByTreatmentId.set(followUp.treatment_id, rows);
  }

  return {
    ok: true,
    rows: scopedTreatments.map((treatment) => ({
      treatment,
      latestRevision: latestRevisionByTreatmentId.get(treatment.id) ?? null,
      followUps: followUpsByTreatmentId.get(treatment.id) ?? [],
    })),
  };
}

export async function listTreatmentFollowUpQueue(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
  status?: TreatmentFollowUpStatus | "all";
  dueOnOrBefore?: string | null;
}): Promise<
  { ok: true; rows: FollowUpQueueItem[] }
  | { ok: false; reason: "forbidden" | "invalid_request" }
> {
  if (!isUuid(params.userId) || !isUuid(params.studioId)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (params.locationId && !isUuid(params.locationId)) {
    return { ok: false, reason: "invalid_request" };
  }

  const actorResult = await resolveTreatmentActor({
    userId: params.userId,
    email: params.email ?? null,
    studioId: params.studioId,
    preferredLocationId: params.locationId ?? null,
  });
  if (!actorResult.ok) return actorResult;
  const actor = actorResult.actor;

  const admin = createAdminClient();
  let query = admin
    .from("salon_treatment_follow_ups")
    .select("*")
    .eq("studio_id", params.studioId)
    .order("due_on", { ascending: true })
    .order("created_at", { ascending: true });

  if (params.locationId) query = query.eq("location_id", params.locationId);
  if (params.status && params.status !== "all") query = query.eq("status", params.status);
  if (params.dueOnOrBefore) query = query.lte("due_on", params.dueOnOrBefore);

  const { data: followUps, error: followError } = await query.returns<SalonTreatmentFollowUp[]>();
  if (followError) throw followError;

  const allFollowUps = followUps ?? [];
  if (!allFollowUps.length) return { ok: true, rows: [] };

  const treatmentIds = [...new Set(allFollowUps.map((row) => row.treatment_id))];
  const { data: treatments, error: treatmentError } = await admin
    .from("salon_treatments")
    .select("id, appointment_id, location_id, actual_employee_id, service_title_snapshot, actual_employee_name_snapshot")
    .eq("studio_id", params.studioId)
    .in("id", treatmentIds)
    .returns<Array<Pick<SalonTreatment, "id" | "appointment_id" | "location_id" | "actual_employee_id" | "service_title_snapshot" | "actual_employee_name_snapshot">>>();
  if (treatmentError) throw treatmentError;

  const treatmentMap = new Map((treatments ?? []).map((row) => [row.id, row]));

  let allowedFollowUps = allFollowUps;
  if (!(actor.hasGlobalOwnerScope || actor.hasGlobalManagerScope)) {
    const actorEmployeeIdSet = new Set(actor.actorEmployeeIds);
    allowedFollowUps = allFollowUps.filter((row) => {
      const treatment = treatmentMap.get(row.treatment_id);
      if (!treatment) return false;
      const scopedRole = actor.scopedRoleByLocationId[treatment.location_id] ?? null;
      return canMutateTreatmentInScopedLocation({
        scopedRole,
        servedByActor: actorEmployeeIdSet.has(treatment.actual_employee_id),
      });
    });
  }

  return {
    ok: true,
    rows: allowedFollowUps
      .map((followUp) => {
        const treatment = treatmentMap.get(followUp.treatment_id);
        if (!treatment) return null;
        return {
          ...followUp,
          treatment: {
            id: treatment.id,
            appointment_id: treatment.appointment_id,
            service_title_snapshot: treatment.service_title_snapshot,
            actual_employee_name_snapshot: treatment.actual_employee_name_snapshot,
          },
        } satisfies FollowUpQueueItem;
      })
      .filter((row): row is FollowUpQueueItem => Boolean(row)),
  };
}

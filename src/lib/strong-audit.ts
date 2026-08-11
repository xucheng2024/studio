import "server-only";

import { requireGlobalStaffScope, type StaffScopeFailureReason } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export type StrongAuditActorType = "user" | "system" | "service";

export type StrongAuditLog = {
  id: string;
  studio_id: string;
  location_id: string | null;
  actor_type: StrongAuditActorType;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before_state: unknown;
  after_state: unknown;
  correlation_id: string | null;
  idempotency_key_id: string | null;
  provider_event_id: string | null;
  created_at: string;
};

export type WriteStrongAuditInput = {
  studioId: string;
  action: string;
  targetType: string;
  actorType?: StrongAuditActorType;
  locationId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  targetId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  correlationId?: string | null;
  idempotencyKeyId?: string | null;
  providerEventId?: string | null;
};

/**
 * Records a critical-business-mutation audit entry via the append-only
 * record_strong_audit RPC (studio/location consistency and append-only are
 * enforced in the database, not here). This call is one standalone
 * transaction: for true atomicity with a business mutation, call
 * `perform public.record_strong_audit(...)` directly from inside that
 * mutation's own SECURITY DEFINER RPC instead of using this wrapper.
 *
 * Callers must not pass secrets, complete health records, or Payroll detail
 * into beforeState/afterState — this table has no field-level redaction.
 */
export async function writeStrongAudit(
  params: WriteStrongAuditInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: "invalid_request"; message?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_strong_audit", {
    p_studio_id: params.studioId,
    p_action: params.action,
    p_target_type: params.targetType,
    p_actor_type: params.actorType ?? "system",
    p_location_id: params.locationId ?? null,
    p_actor_id: params.actorId ?? null,
    p_actor_role: params.actorRole ?? null,
    p_target_id: params.targetId ?? null,
    p_before_state: params.beforeState ?? null,
    p_after_state: params.afterState ?? null,
    p_correlation_id: params.correlationId ?? null,
    p_idempotency_key_id: params.idempotencyKeyId ?? null,
    p_provider_event_id: params.providerEventId ?? null,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true, id: data as string };
}

const STRONG_AUDIT_READ_ROLES = ["owner", "manager"] as const;

/**
 * Reads the strong audit trail for a studio. Conservative default access:
 * only Owner / studio-wide (all-location) Manager — mirrors
 * hasGlobalCustomerReadAccess in salon-customers.ts, avoiding a scope leak
 * where a single-location manager could read another location's entries.
 * This is FND-04's own default for its one actor-facing entry point, not a
 * role policy future business modules are required to reuse.
 */
export async function getStrongAuditTrail(params: {
  userId: string;
  studioId: string;
  locationId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  limit?: number;
}): Promise<{ ok: true; records: StrongAuditLog[] } | { ok: false; reason: StaffScopeFailureReason }> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...STRONG_AUDIT_READ_ROLES],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const requestedLimit = params.limit ?? 100;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 500)
    : 100;
  let query = admin
    .from("strong_audit_logs")
    .select("*")
    .eq("studio_id", params.studioId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (params.locationId) query = query.eq("location_id", params.locationId);
  if (params.targetType) query = query.eq("target_type", params.targetType);
  if (params.targetId) query = query.eq("target_id", params.targetId);

  const { data, error } = await query.returns<StrongAuditLog[]>();
  if (error) throw error;
  return { ok: true, records: data ?? [] };
}

import "server-only";

import { hashIdempotencyRequest } from "@/lib/idempotency";
import { requireStaffScope } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

const PKG02_MAKER_ROLES = ["owner", "manager", "frontdesk"] as const;
const PKG02_CHECKER_ROLES = ["owner", "manager"] as const;

export type PkgApprovalErrorCode =
  | "forbidden"
  | "studio_not_found"
  | "studio_suspended"
  | "invalid_request"
  | "not_found"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "idempotency_permanently_failed"
  | "concurrency_conflict"
  | "unknown";

export type PkgApprovalResult<TPayload> =
  | { ok: true; payload: TPayload }
  | { ok: false; code: PkgApprovalErrorCode; message: string };

export type Pkg02RequestPayload = {
  request_id: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "applied";
  version: number;
};

export type Pkg02ApplyPayload = Pkg02RequestPayload & {
  already_applied: boolean;
  ledger_entry_id: string;
};

type Pkg02Decision = "approved" | "rejected";

function trimToNull(raw: string | null | undefined) {
  const value = raw?.trim();
  return value ? value : null;
}

function mapPkgRpcError(error: { code?: string; message?: string }): {
  code: PkgApprovalErrorCode;
  message: string;
} {
  const message = error.message ?? "Unknown PKG-02 approval error";
  if (!error.code) return { code: "unknown", message };

  switch (error.code) {
    case "P0002":
      return { code: "not_found", message };
    case "42501":
      return { code: "forbidden", message };
    case "22023":
      return { code: "invalid_request", message };
    case "40001":
      return { code: "concurrency_conflict", message };
    case "23514":
      if (/hash_conflict/i.test(message)) return { code: "idempotency_conflict", message };
      if (/in_progress/i.test(message)) return { code: "idempotency_in_progress", message };
      if (/permanently_failed/i.test(message)) return { code: "idempotency_permanently_failed", message };
      if (/version conflict/i.test(message)) return { code: "concurrency_conflict", message };
      if (/scope|forbidden|permission|role|self-approve/i.test(message)) return { code: "forbidden", message };
      return { code: "invalid_request", message };
    default:
      return { code: "unknown", message };
  }
}

export async function createPkg02AdjustmentRequest(params: {
  userId: string;
  studioId: string;
  clientPackageId: string;
  requestedDeltaCredits: number;
  reason?: string | null;
  requestedValueDeltaAmount?: number | null;
  currency?: string | null;
  locationId?: string | null;
  salonCustomerId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<PkgApprovalResult<Pkg02RequestPayload>> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...PKG02_MAKER_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pkg02_create_adjustment_request", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_client_package_id: params.clientPackageId,
    p_requested_delta_credits: params.requestedDeltaCredits,
    p_reason: trimToNull(params.reason),
    p_requested_value_delta_amount: params.requestedValueDeltaAmount ?? null,
    p_currency: trimToNull(params.currency) ?? "SGD",
    p_location_id: trimToNull(params.locationId),
    p_salon_customer_id: trimToNull(params.salonCustomerId),
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    const mapped = mapPkgRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as Pkg02RequestPayload };
}

export async function submitPkg02AdjustmentRequest(params: {
  userId: string;
  studioId: string;
  requestId: string;
  expectedVersion?: number | null;
  note?: string | null;
}): Promise<PkgApprovalResult<Pkg02RequestPayload>> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...PKG02_MAKER_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pkg02_submit_adjustment_request", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_request_id: params.requestId,
    p_expected_version: params.expectedVersion ?? null,
    p_note: trimToNull(params.note),
  });

  if (error) {
    const mapped = mapPkgRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as Pkg02RequestPayload };
}

export async function decidePkg02AdjustmentRequest(params: {
  userId: string;
  studioId: string;
  requestId: string;
  decision: Pkg02Decision;
  expectedVersion?: number | null;
  rejectionReason?: string | null;
  note?: string | null;
}): Promise<PkgApprovalResult<Pkg02RequestPayload>> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...PKG02_CHECKER_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pkg02_decide_adjustment_request", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_request_id: params.requestId,
    p_decision: params.decision,
    p_expected_version: params.expectedVersion ?? null,
    p_rejection_reason: trimToNull(params.rejectionReason),
    p_note: trimToNull(params.note),
  });

  if (error) {
    const mapped = mapPkgRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as Pkg02RequestPayload };
}

function buildApplyIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  requestId: string;
  expectedVersion?: number | null;
  note?: string | null;
  correlationId?: string | null;
}) {
  const requestPayload = {
    operation: "pkg02_adjustment:apply",
    studioId: params.studioId,
    requestId: params.requestId,
    expectedVersion: params.expectedVersion ?? null,
    note: trimToNull(params.note),
    correlationId: trimToNull(params.correlationId),
  };
  return {
    idempotencyKey: trimToNull(params.idempotencyKey) ?? crypto.randomUUID(),
    requestHash: hashIdempotencyRequest(requestPayload),
  };
}

export async function applyPkg02AdjustmentRequest(params: {
  userId: string;
  studioId: string;
  requestId: string;
  expectedVersion?: number | null;
  idempotencyKey?: string | null;
  note?: string | null;
  correlationId?: string | null;
}): Promise<PkgApprovalResult<Pkg02ApplyPayload>> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...PKG02_CHECKER_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const idempotency = buildApplyIdempotency({
    idempotencyKey: params.idempotencyKey,
    studioId: params.studioId,
    requestId: params.requestId,
    expectedVersion: params.expectedVersion,
    note: params.note,
    correlationId: params.correlationId,
  });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pkg02_apply_adjustment_request", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_request_id: params.requestId,
    p_idempotency_key: idempotency.idempotencyKey,
    p_request_hash: idempotency.requestHash,
    p_expected_version: params.expectedVersion ?? null,
    p_note: trimToNull(params.note),
    p_correlation_id: trimToNull(params.correlationId),
  });

  if (error) {
    const mapped = mapPkgRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as Pkg02ApplyPayload };
}

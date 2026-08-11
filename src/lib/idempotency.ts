import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

function canonicalizeJson(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") throw new TypeError("Idempotency payload cannot contain bigint");
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (ancestors.has(value)) throw new TypeError("Idempotency payload cannot be circular");
  ancestors.add(value);
  try {
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === "function") return canonicalizeJson(toJSON.call(value), ancestors);
    if (Array.isArray(value)) {
      return value.map((item) => canonicalizeJson(item, ancestors) ?? null);
    }

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = canonicalizeJson((value as Record<string, unknown>)[key], ancestors);
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

/** Stable sha256 of a JSON-compatible request payload, with object keys sorted recursively. */
export function hashIdempotencyRequest(payload: unknown): string {
  const serialized = JSON.stringify(canonicalizeJson(payload, new WeakSet()));
  if (serialized === undefined) throw new TypeError("Idempotency payload must be JSON-compatible");
  return createHash("sha256").update(serialized).digest("hex");
}

export type IdempotencyClaimResult =
  | { ok: true; outcome: "claimed"; id: string; claimToken: string; attemptCount: number }
  | { ok: true; outcome: "already_completed"; id: string; result: unknown }
  | { ok: true; outcome: "in_progress"; id: string }
  | { ok: false; outcome: "hash_conflict"; id: string }
  | { ok: false; outcome: "permanently_failed"; id: string; errorSummary: string | null };

/**
 * Studio-scoped idempotency Claim. The row lock selects one winner for
 * concurrent claims; claimToken fences later Complete/Fail calls after a
 * stale claim is reclaimed. This is a thin system-level primitive: the
 * caller's own Server Action / RPC must already have validated actor
 * Studio/Location scope, and business mutations must enforce their own
 * unique constraint or atomically validate the current token.
 */
export async function claimIdempotencyKey(params: {
  studioId: string;
  operationScope: string;
  idempotencyKey: string;
  requestHash: string;
  staleAfterSeconds?: number;
}): Promise<IdempotencyClaimResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_business_idempotency_key", {
    p_studio_id: params.studioId,
    p_operation_scope: params.operationScope,
    p_idempotency_key: params.idempotencyKey,
    p_request_hash: params.requestHash,
    p_stale_after_seconds: params.staleAfterSeconds ?? 300,
  });
  if (error) throw error;
  return data as IdempotencyClaimResult;
}

/**
 * Marks a claimed idempotency key as completed. resultSnapshot must not
 * contain secrets, complete health records, or Payroll detail — store only
 * what a retried caller needs to reconstruct the prior response.
 */
export async function completeIdempotencyKey(params: {
  recordId: string;
  claimToken: string;
  resultSnapshot?: unknown;
}): Promise<{ ok: true } | { ok: false; reason: "not_current_claim" }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_business_idempotency_key", {
    p_id: params.recordId,
    p_claim_token: params.claimToken,
    p_result_snapshot: params.resultSnapshot ?? null,
  });
  if (error) throw error;
  const result = data as { ok: boolean; reason?: "not_current_claim" };
  return result.ok ? { ok: true } : { ok: false, reason: "not_current_claim" };
}

/**
 * Marks a claimed idempotency key as failed. Pass retryable: false for
 * permanent failures so a later claim with the same key returns
 * permanently_failed instead of retrying indefinitely.
 */
export async function failIdempotencyKey(params: {
  recordId: string;
  claimToken: string;
  errorSummary: string;
  retryable?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: "not_current_claim" }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_business_idempotency_key", {
    p_id: params.recordId,
    p_claim_token: params.claimToken,
    p_error_summary: params.errorSummary,
    p_retryable: params.retryable ?? true,
  });
  if (error) throw error;
  const result = data as { ok: boolean; reason?: "not_current_claim" };
  return result.ok ? { ok: true } : { ok: false, reason: "not_current_claim" };
}

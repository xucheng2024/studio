import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** Stable sha256 of a raw provider payload, for the payloadHash argument below. */
export function hashProviderPayload(payload: string | Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

export type ProviderEventClaimResult =
  | { ok: true; outcome: "claimed"; id: string; claimToken: string; attemptCount: number }
  | { ok: true; outcome: "already_processed"; id: string; duplicate: true }
  | { ok: true; outcome: "in_progress"; id: string; duplicate: true }
  | { ok: false; outcome: "payload_conflict"; id: string }
  | { ok: false; outcome: "scope_conflict"; id: string }
  | { ok: false; outcome: "permanently_failed"; id: string; errorSummary: string | null };

/**
 * Provider/Event-ID replay dedup Claim. A replayed webhook (same provider +
 * provider_event_id + payload hash, already processed) returns
 * already_processed with duplicate: true — callers must treat that as "skip
 * the business action", never re-run it. A different payload hash under the
 * same provider_event_id is a payload_conflict and the original event is
 * never silently overwritten.
 *
 * studioId/locationId are optional: pass them once resolved from the
 * payload (e.g. after looking up the related payment), null otherwise.
 * Do not pass provider secrets or raw personal data in safePayload — only
 * the minimal, already-redacted fields a later reconciliation might need.
 */
export async function claimProviderEvent(params: {
  provider: string;
  providerEventId: string;
  payloadHash: string;
  eventType?: string | null;
  studioId?: string | null;
  locationId?: string | null;
  safePayload?: unknown;
  staleAfterSeconds?: number;
}): Promise<ProviderEventClaimResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_provider_event", {
    p_provider: params.provider,
    p_provider_event_id: params.providerEventId,
    p_payload_hash: params.payloadHash,
    p_event_type: params.eventType ?? null,
    p_studio_id: params.studioId ?? null,
    p_location_id: params.locationId ?? null,
    p_safe_payload: params.safePayload ?? null,
    p_stale_after_seconds: params.staleAfterSeconds ?? 300,
  });
  if (error) throw error;
  return data as ProviderEventClaimResult;
}

export async function completeProviderEvent(params: {
  recordId: string;
  claimToken: string;
  studioId?: string | null;
  locationId?: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "not_current_claim" | "scope_conflict" | "invalid_scope" }
> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_provider_event", {
    p_id: params.recordId,
    p_claim_token: params.claimToken,
    p_studio_id: params.studioId ?? null,
    p_location_id: params.locationId ?? null,
  });
  if (error) throw error;
  const result = data as {
    ok: boolean;
    reason?: "not_current_claim" | "scope_conflict" | "invalid_scope";
  };
  return result.ok
    ? { ok: true }
    : { ok: false, reason: result.reason ?? "not_current_claim" };
}

export async function failProviderEvent(params: {
  recordId: string;
  claimToken: string;
  errorSummary: string;
  retryable?: boolean;
  studioId?: string | null;
  locationId?: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "not_current_claim" | "scope_conflict" | "invalid_scope" }
> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_provider_event", {
    p_id: params.recordId,
    p_claim_token: params.claimToken,
    p_error_summary: params.errorSummary,
    p_retryable: params.retryable ?? true,
    p_studio_id: params.studioId ?? null,
    p_location_id: params.locationId ?? null,
  });
  if (error) throw error;
  const result = data as {
    ok: boolean;
    reason?: "not_current_claim" | "scope_conflict" | "invalid_scope";
  };
  return result.ok
    ? { ok: true }
    : { ok: false, reason: result.reason ?? "not_current_claim" };
}

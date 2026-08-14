"use server";

import {
  applyPkg02AdjustmentRequest,
  createPkg02AdjustmentRequest,
  decidePkg02AdjustmentRequest,
  submitPkg02AdjustmentRequest,
  type PkgApprovalErrorCode,
} from "@/lib/pkg-approvals";
import { getPkgApprovalMessage } from "@/lib/pkg-approval-messages";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

export type Pkg02ApprovalActionResult = DashboardFormResult & {
  request_id?: string;
  status?: "draft" | "submitted" | "approved" | "rejected" | "applied";
  version?: number;
  ledger_entry_id?: string;
};

function parseInteger(raw: FormDataEntryValue | null) {
  if (raw == null || String(raw).trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function parseNumber(raw: FormDataEntryValue | null) {
  if (raw == null || String(raw).trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapPkgApprovalMessage(code: PkgApprovalErrorCode, fallback: string) {
  return getPkgApprovalMessage(code, fallback);
}

export async function createPkg02AdjustmentRequestAction(
  _prevState: Pkg02ApprovalActionResult | null,
  formData: FormData,
): Promise<Pkg02ApprovalActionResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const clientPackageId = String(formData.get("client_package_id") ?? "").trim();
  const requestedDeltaCredits = parseInteger(formData.get("requested_delta_credits"));
  const requestedValueDeltaAmount = parseNumber(formData.get("requested_value_delta_amount"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const currency = String(formData.get("currency") ?? "").trim() || "SGD";
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const salonCustomerId = String(formData.get("salon_customer_id") ?? "").trim() || null;

  if (!studioId || !clientPackageId || requestedDeltaCredits == null || requestedDeltaCredits === 0) {
    return err("Missing required fields: studio, package, and non-zero delta credits.");
  }

  const { user } = await requireUser();
  const result = await createPkg02AdjustmentRequest({
    userId: user.id,
    studioId,
    clientPackageId,
    requestedDeltaCredits,
    requestedValueDeltaAmount,
    reason,
    currency,
    locationId,
    salonCustomerId,
    metadata: {
      source: "dashboard_action",
    },
  });

  if (!result.ok) {
    return err(mapPkgApprovalMessage(result.code, result.message || "Could not create adjustment request."));
  }

  return {
    ...ok("Adjustment request draft created."),
    request_id: result.payload.request_id,
    status: result.payload.status,
    version: result.payload.version,
  };
}

export async function submitPkg02AdjustmentRequestAction(
  _prevState: Pkg02ApprovalActionResult | null,
  formData: FormData,
): Promise<Pkg02ApprovalActionResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "").trim();
  const expectedVersion = parseInteger(formData.get("expected_version"));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!studioId || !requestId) {
    return err("Missing required fields: studio and request.");
  }

  const { user } = await requireUser();
  const result = await submitPkg02AdjustmentRequest({
    userId: user.id,
    studioId,
    requestId,
    expectedVersion,
    note,
  });

  if (!result.ok) {
    return err(mapPkgApprovalMessage(result.code, result.message || "Could not submit adjustment request."));
  }

  return {
    ...ok("Adjustment request submitted for checker approval."),
    request_id: result.payload.request_id,
    status: result.payload.status,
    version: result.payload.version,
  };
}

export async function approvePkg02AdjustmentRequestAction(
  _prevState: Pkg02ApprovalActionResult | null,
  formData: FormData,
): Promise<Pkg02ApprovalActionResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "").trim();
  const expectedVersion = parseInteger(formData.get("expected_version"));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!studioId || !requestId) {
    return err("Missing required fields: studio and request.");
  }

  const { user } = await requireUser();
  const result = await decidePkg02AdjustmentRequest({
    userId: user.id,
    studioId,
    requestId,
    decision: "approved",
    expectedVersion,
    note,
  });

  if (!result.ok) {
    return err(mapPkgApprovalMessage(result.code, result.message || "Could not approve adjustment request."));
  }

  return {
    ...ok("Adjustment request approved."),
    request_id: result.payload.request_id,
    status: result.payload.status,
    version: result.payload.version,
  };
}

export async function rejectPkg02AdjustmentRequestAction(
  _prevState: Pkg02ApprovalActionResult | null,
  formData: FormData,
): Promise<Pkg02ApprovalActionResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "").trim();
  const expectedVersion = parseInteger(formData.get("expected_version"));
  const note = String(formData.get("note") ?? "").trim() || null;
  const rejectionReason = String(formData.get("rejection_reason") ?? "").trim() || null;

  if (!studioId || !requestId) {
    return err("Missing required fields: studio and request.");
  }

  const { user } = await requireUser();
  const result = await decidePkg02AdjustmentRequest({
    userId: user.id,
    studioId,
    requestId,
    decision: "rejected",
    expectedVersion,
    rejectionReason,
    note,
  });

  if (!result.ok) {
    return err(mapPkgApprovalMessage(result.code, result.message || "Could not reject adjustment request."));
  }

  return {
    ...ok("Adjustment request rejected."),
    request_id: result.payload.request_id,
    status: result.payload.status,
    version: result.payload.version,
  };
}

export async function applyPkg02AdjustmentRequestAction(
  _prevState: Pkg02ApprovalActionResult | null,
  formData: FormData,
): Promise<Pkg02ApprovalActionResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "").trim();
  const expectedVersion = parseInteger(formData.get("expected_version"));
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const correlationId = String(formData.get("correlation_id") ?? "").trim() || null;

  if (!studioId || !requestId) {
    return err("Missing required fields: studio and request.");
  }

  const { user } = await requireUser();
  const result = await applyPkg02AdjustmentRequest({
    userId: user.id,
    studioId,
    requestId,
    expectedVersion,
    idempotencyKey,
    note,
    correlationId,
  });

  if (!result.ok) {
    return err(mapPkgApprovalMessage(result.code, result.message || "Could not apply approved adjustment."));
  }

  return {
    ...ok(result.payload.already_applied ? "Adjustment already applied." : "Adjustment applied to package ledger."),
    request_id: result.payload.request_id,
    status: result.payload.status,
    version: result.payload.version,
    ledger_entry_id: result.payload.ledger_entry_id,
  };
}

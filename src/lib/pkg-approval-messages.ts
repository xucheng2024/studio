import type { PkgApprovalErrorCode } from "@/lib/pkg-approvals";

const PKG_APPROVAL_MESSAGES: Record<PkgApprovalErrorCode, string> = {
  forbidden: "You cannot approve or apply your own request. Ask another owner or manager.",
  studio_not_found: "Studio not found.",
  studio_suspended: "Studio contract is suspended.",
  invalid_request: "This request cannot be updated. Check the fields and status, then try again.",
  not_found: "This request was not found. Refresh the list and try again.",
  idempotency_conflict: "This apply attempt does not match the latest request. Refresh and apply again.",
  idempotency_in_progress: "Credits are already being applied. Wait a few seconds, refresh, then try once.",
  idempotency_permanently_failed: "The last apply attempt failed. Refresh the request and apply again.",
  concurrency_conflict: "Someone else updated this request. Refresh the list and try again.",
  unknown: "Could not complete this step. Try again shortly, or contact support if it continues.",
};

export const PKG_APPROVAL_SELF_ACTION_BLOCKED_MESSAGE =
  "You cannot approve or apply a request you created. Ask another owner or manager.";

export function getPkgApprovalMessage(code: PkgApprovalErrorCode, fallback: string) {
  return PKG_APPROVAL_MESSAGES[code] ?? fallback;
}


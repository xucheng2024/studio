import type { PkgApprovalErrorCode } from "@/lib/pkg-approvals";

const PKG_APPROVAL_MESSAGES: Record<PkgApprovalErrorCode, string> = {
  forbidden: "Access denied for this step. Use an owner/manager checker account; maker cannot self-approve/apply.",
  studio_not_found: "Studio not found.",
  studio_suspended: "Studio contract is suspended.",
  invalid_request: "Invalid approval request. Check fields and status.",
  not_found: "Adjustment request not found. Refresh list and retry from latest state.",
  idempotency_conflict: "Idempotency replay mismatch detected. Start a new apply attempt from the latest request state.",
  idempotency_in_progress: "Apply is already processing. Wait a few seconds, refresh, then retry once.",
  idempotency_permanently_failed: "Previous apply attempt is permanently failed. Re-run apply with a new request key.",
  concurrency_conflict: "Request state changed by another user. Refresh list, reopen the request, then retry.",
  unknown: "Unknown approval error. Retry shortly, or contact support if it persists.",
};

export const PKG_APPROVAL_SELF_ACTION_BLOCKED_MESSAGE =
  "Access denied: maker cannot self-approve/apply. Use another owner/manager checker account.";

export function getPkgApprovalMessage(code: PkgApprovalErrorCode, fallback: string) {
  return PKG_APPROVAL_MESSAGES[code] ?? fallback;
}


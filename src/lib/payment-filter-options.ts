/** Matches `payments_status_check` in migrations. */
export const PAYMENT_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "expired", label: "Expired" },
  { value: "refunded", label: "Refunded" },
];

/** Matches `payments_recon_status_check` (migration 015). */
export const RECON_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "awaiting_verification", label: "Awaiting verification" },
  { value: "matched", label: "Matched" },
  { value: "mismatch", label: "Mismatch" },
  { value: "needs_review", label: "Needs review" },
  { value: "manual_review", label: "Manual review" },
];

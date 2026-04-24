/** Matches `payments_status_check` in migrations. */
export const PAYMENT_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "expired", label: "Expired" },
  { value: "refunded", label: "Refunded" },
];

export const PAYMENT_METHOD_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "hitpay", label: "HitPay" },
  { value: "cash", label: "Cash" },
];

/** Matches `payments_invoice_status_check` (migration 024). */
export const INVOICE_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "issued", label: "Issued" },
  { value: "void", label: "Void" },
];


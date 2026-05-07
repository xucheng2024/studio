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

export const PAYMENT_SOURCE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "online_booking", label: "Session booking" },
  { value: "walkin", label: "Walk-in session" },
  { value: "event_booking", label: "Event booking" },
  { value: "package_buy", label: "Package purchase" },
];

/** Matches `payments_invoice_status_check` (migration 024). */
export const INVOICE_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "issued", label: "Issued" },
  { value: "void", label: "Void" },
];

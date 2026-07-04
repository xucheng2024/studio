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
  { value: "free", label: "Free" },
];

export const PAYMENT_SOURCE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "online_booking", label: "Session" },
  { value: "walkin", label: "Walk-in" },
  { value: "event_booking", label: "Event" },
  { value: "package_buy", label: "Package" },
  { value: "member_zone_purchase", label: "Member zone" },
  { value: "shop_purchase", label: "Shop" },
  { value: "service_purchase", label: "Service" },
  { value: "membership_subscription", label: "Membership" },
];

/** Matches `payments_invoice_status_check` (migration 024). */
export const INVOICE_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "issued", label: "Issued" },
  { value: "void", label: "Void" },
];

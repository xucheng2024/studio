/** Maps HitPay recurring-billing / webhook status strings to `customer_subscriptions.status`. */
export function normalizeHitpayRecurringBillingStatus(raw: string | null | undefined) {
  const status = String(raw ?? "").trim().toLowerCase();
  if (status === "cancelled") return "canceled";
  if (["scheduled", "active", "retrying", "inactive", "paused", "canceled"].includes(status)) return status;
  if (status === "succeeded") return "active";
  return null;
}

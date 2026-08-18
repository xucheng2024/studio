export function collectPendingPaymentHref(input: {
  studioId?: string | null;
  locationId?: string | null;
  posSaleId?: string | null;
  paymentId?: string | null;
  query?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.studioId) params.set("studio_id", input.studioId);
  if (input.locationId) params.set("location_id", input.locationId);

  if (input.posSaleId) {
    params.set("sale_id", input.posSaleId);
    const q = params.toString();
    return `/dashboard/pos${q ? `?${q}` : ""}`;
  }

  if (input.paymentId) {
    params.set("payment_id", input.paymentId);
    const q = params.toString();
    return `/dashboard/payments${q ? `?${q}` : ""}`;
  }

  const query = input.query?.trim();
  if (query) params.set("q", query);
  const q = params.toString();
  return `/dashboard/payments${q ? `?${q}` : ""}`;
}

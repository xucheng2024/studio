/**
 * Builds the studio/location (+ optional search) query params staff links carry between
 * dashboard pages. Keep `q`/`status` scoped to links that stay within the customer list's
 * own search context (e.g. "open customer", "clear", "back to customers") — destinations
 * like appointments, POS, or the follow-up queue have no use for a customer-list search term.
 */
export function buildScopeParams(input: {
  studioId?: string | null;
  locationId?: string | null;
  q?: string | null;
  status?: string | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.studioId) params.set("studio_id", input.studioId);
  if (input.locationId) params.set("location_id", input.locationId);
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.status?.trim()) params.set("status", input.status.trim());
  return params;
}

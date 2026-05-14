/** Only http(s) URLs for public redirects (blocks javascript:, data:, etc.). */
export function sanitizeEventExternalBookingUrl(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return u.href;
}

export const RESERVED_PUBLIC_SLUGS = new Set([
  "api",
  "auth",
  "login",
  "register",
  "signup",
  "dashboard",
  "booking",
  "buy",
  "checkout",
  "class",
  "me",
  "instructor",
  "account",
  "post-auth",
]);

export function isReservedPublicSlug(slug: string): boolean {
  return RESERVED_PUBLIC_SLUGS.has(slug.trim().toLowerCase());
}

export function studioWhatsappLink(params: {
  enabled: boolean | null | undefined;
  numberE164: string | null | undefined;
  prefillText: string | null | undefined;
}) {
  if (!params.enabled) return null;
  const raw = String(params.numberE164 ?? "").trim();
  if (!/^\+[1-9][0-9]{6,14}$/.test(raw)) return null;
  const number = raw.replace("+", "");
  const text = (params.prefillText ?? "").trim() || "Hi, I’m interested in your services.";
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

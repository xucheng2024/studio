import { redirect } from "next/navigation";
import { buildAccessContext } from "@/lib/rbac";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { generateShareSlugSegment } from "@/lib/shareSlug";
import { createClient } from "@/lib/supabase/server";

export type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
export type StudioScope = Awaited<ReturnType<typeof requireStudio>>;

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function requireStudio(requestedStudioId?: string) {
  const { supabase, user } = await requireUser();
  const ctx = await buildAccessContext(user.id, user.email ?? null, null);
  const studioIds = [...new Set(ctx.memberships.map((membership) => membership.studio_id))];
  const studioId = requestedStudioId
    ? (ctx.isSuperAdmin || studioIds.includes(requestedStudioId))
      ? requestedStudioId
      : null
    : studioIds.length === 1
      ? studioIds[0]
      : null;
  if (!studioId) return { supabase, user, studio: null as null, ctx };

  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, contract_ends_at")
    .eq("id", studioId)
    .maybeSingle();
  return { supabase, user, studio, ctx };
}

export function hasStudioRole(
  ctx: StudioScope["ctx"],
  studioId: string,
  roles: Array<"owner" | "manager" | "frontdesk" | "instructor">,
) {
  if (ctx.isSuperAdmin) return true;
  return ctx.memberships.some(
    (membership) => membership.studio_id === studioId && roles.includes(membership.role as (typeof roles)[number]),
  );
}

export function hasStudioLocationRole(
  ctx: StudioScope["ctx"],
  studioId: string,
  locationId: string | null,
  roles: Array<"owner" | "manager" | "frontdesk" | "instructor">,
) {
  if (ctx.isSuperAdmin) return true;
  const scopedMemberships = ctx.memberships.filter(
    (membership) =>
      membership.studio_id === studioId &&
      roles.includes(membership.role as (typeof roles)[number]),
  );
  if (scopedMemberships.some((membership) => membership.location_id == null)) {
    return true;
  }
  if (!locationId) return false;
  return scopedMemberships.some((membership) => membership.location_id === locationId);
}

export async function assertLocationInStudio(
  supabase: SupabaseClient,
  studioId: string,
  locationId: string | null,
) {
  if (!locationId) return true;
  const { data: location } = await supabase
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(location);
}

export async function requireOwnedStudioAccess(
  supabase: SupabaseClient,
  studioId: string,
  userId: string,
  redirectTo: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ctx = await buildAccessContext(userId, user?.email ?? null, null);
  const { data: studio } = await supabase
    .from("studios")
    .select("id, contract_status")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio || !hasStudioRole(ctx, studioId, ["owner"])) {
    redirect(redirectTo);
  }
  return studio;
}

export async function generateUniqueShareSlug(
  supabase: SupabaseClient,
  table:
    | "studio_services"
    | "membership_products"
    | "shop_products"
    | "events"
    | "member_zone_series",
  studioId: string,
): Promise<string | null> {
  for (let i = 0; i < 15; i += 1) {
    const candidate = generateShareSlugSegment(10);
    const { data: existing } = await supabase
      .from(table)
      .select("id")
      .eq("studio_id", studioId)
      .eq("share_slug", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  return null;
}

export function normalizeE164(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\+[1-9][0-9]{6,14}$/.test(value)) return null;
  return value;
}

export function sanitizeVideoUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
}

export function sanitizePublicExternalUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizePublicEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function sanitizeTrustedLogoUrl(raw: string | null): string | null {
  const value = raw?.trim() || null;
  if (!value) return null;
  return isTrustedCoverImageUrl(value) ? value : null;
}

export function sanitizePriceNullable(raw: FormDataEntryValue | null): number | null {
  if (raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

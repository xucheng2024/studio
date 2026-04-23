import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeStudioSlug } from "@/lib/slug";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";

export async function getActiveMemberStudioSlugFromCookie() {
  const c = await cookies();
  const raw = c.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? null;
  return raw ? normalizeStudioSlug(raw) : null;
}

export async function upsertMemberStudioMembership(
  admin: SupabaseClient,
  params: { userId: string; studioId: string },
) {
  const nowIso = new Date().toISOString();
  await admin
    .from("member_studio_memberships")
    .upsert(
      {
        user_id: params.userId,
        studio_id: params.studioId,
        status: "active",
        joined_at: nowIso,
        revoked_at: null,
      },
      { onConflict: "user_id,studio_id" },
    );
}

export async function verifyMemberStudioAccess(
  admin: SupabaseClient,
  params: { userId: string; studioId: string; bootstrapIfMissing?: boolean },
) {
  const { data: studio } = await admin
    .from("studios")
    .select("id, public_slug")
    .eq("id", params.studioId)
    .maybeSingle();
  const studioSlug = normalizeStudioSlug(studio?.public_slug ?? "");
  if (!studioSlug) return { ok: false as const, reason: "studio_not_found" };

  const activeSlug = await getActiveMemberStudioSlugFromCookie();
  if (activeSlug && activeSlug !== studioSlug) {
    return { ok: false as const, reason: "studio_context_mismatch" };
  }

  const { data: membership } = await admin
    .from("member_studio_memberships")
    .select("id")
    .eq("user_id", params.userId)
    .eq("studio_id", params.studioId)
    .eq("status", "active")
    .maybeSingle();
  if (membership?.id) return { ok: true as const, studioSlug };

  if (params.bootstrapIfMissing && activeSlug === studioSlug) {
    await upsertMemberStudioMembership(admin, { userId: params.userId, studioId: params.studioId });
    return { ok: true as const, studioSlug };
  }
  return { ok: false as const, reason: "studio_forbidden" };
}

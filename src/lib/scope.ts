import { createAdminClient } from "@/lib/supabase/admin";

export async function requireStaffScope(params: {
  userId: string;
  studioId: string;
  locationId?: string | null;
  roles?: Array<"owner" | "manager" | "frontdesk" | "instructor">;
}) {
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, owner_id")
    .eq("id", params.studioId)
    .maybeSingle();
  if (!studio) return { ok: false as const, reason: "studio_not_found" };
  if (studio.owner_id === params.userId) return { ok: true as const, role: "owner" };

  let q = admin
    .from("staff_memberships")
    .select("role, location_id")
    .eq("user_id", params.userId)
    .eq("studio_id", params.studioId)
    .eq("is_active", true)
    .limit(1);
  if (params.roles?.length) q = q.in("role", params.roles);
  if (params.locationId) q = q.or(`location_id.is.null,location_id.eq.${params.locationId}`);
  const { data: m } = await q.maybeSingle();
  if (!m) return { ok: false as const, reason: "forbidden" };
  return { ok: true as const, role: m.role };
}

import { NextResponse } from "next/server";
import { buildAccessContext, hasStudioRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStudioContractSuspended } from "@/lib/studio-contract";

export type StaffScopeFailureReason = "studio_not_found" | "studio_suspended" | "forbidden";

export async function requireStaffScope(params: {
  userId: string;
  studioId: string;
  locationId?: string | null;
  roles?: Array<"owner" | "manager" | "frontdesk" | "instructor">;
}) {
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, contract_status")
    .eq("id", params.studioId)
    .maybeSingle();
  if (!studio) return { ok: false as const, reason: "studio_not_found" as StaffScopeFailureReason };
  if (isStudioContractSuspended(studio)) {
    return { ok: false as const, reason: "studio_suspended" as StaffScopeFailureReason };
  }
  const ctx = await buildAccessContext(params.userId, null, params.locationId ?? null);
  if (hasStudioRole(ctx, params.studioId, ["owner"])) return { ok: true as const, role: "owner" };

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
  if (!m) return { ok: false as const, reason: "forbidden" as StaffScopeFailureReason };
  return { ok: true as const, role: m.role };
}

export function staffScopeFailureResponse(failure: { ok: false; reason: StaffScopeFailureReason }) {
  switch (failure.reason) {
    case "studio_not_found":
      return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
    case "studio_suspended":
      return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
    default:
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
}

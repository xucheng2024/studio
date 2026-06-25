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

function getScopedStaffMemberships(
  ctx: Awaited<ReturnType<typeof buildAccessContext>>,
  studioId: string,
  roles?: Array<"owner" | "manager" | "frontdesk" | "instructor">,
) {
  return ctx.memberships.filter(
    (membership) =>
      membership.studio_id === studioId &&
      (!roles || roles.includes(membership.role as "owner" | "manager" | "frontdesk" | "instructor")),
  );
}

export async function requireGlobalStaffScope(params: {
  userId: string;
  studioId: string;
  roles?: Array<"owner" | "manager" | "frontdesk" | "instructor">;
}) {
  const baseScope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: params.roles,
  });
  if (!baseScope.ok) return baseScope;

  const ctx = await buildAccessContext(params.userId, null, null);
  if (hasStudioRole(ctx, params.studioId, ["owner"])) return { ok: true as const, role: "owner" };

  const scopedMemberships = getScopedStaffMemberships(ctx, params.studioId, params.roles);
  const hasGlobalAccess = scopedMemberships.some((membership) => membership.location_id == null);
  if (!hasGlobalAccess) return { ok: false as const, reason: "forbidden" as StaffScopeFailureReason };

  return { ok: true as const, role: baseScope.role };
}

export async function requireStaffMutationScope(params: {
  userId: string;
  studioId: string;
  currentLocationId?: string | null;
  targetLocationId?: string | null;
  roles?: Array<"owner" | "manager" | "frontdesk" | "instructor">;
}) {
  const currentScope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.currentLocationId ?? null,
    roles: params.roles,
  });
  if (!currentScope.ok) return currentScope;
  if (params.targetLocationId === undefined) return currentScope;

  const ctx = await buildAccessContext(params.userId, null, params.targetLocationId ?? null);
  if (hasStudioRole(ctx, params.studioId, ["owner"])) return { ok: true as const, role: "owner" };

  const scopedMemberships = getScopedStaffMemberships(ctx, params.studioId, params.roles);
  const hasTargetAccess =
    params.targetLocationId == null
      ? scopedMemberships.some((membership) => membership.location_id == null)
      : scopedMemberships.some(
          (membership) =>
            membership.location_id == null || membership.location_id === params.targetLocationId,
        );
  if (!hasTargetAccess) return { ok: false as const, reason: "forbidden" as StaffScopeFailureReason };

  return { ok: true as const, role: currentScope.role };
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

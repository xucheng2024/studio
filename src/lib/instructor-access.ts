import { bestRole, hasInstructorRole, hasStudioRole, type AccessContext, type StaffRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function resolveInstructorIdForEmail(
  admin: AdminClient,
  email: string | null | undefined,
) {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  if (!normalizedEmail) return null;
  const { data: instructor } = await admin
    .from("instructors")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  return instructor?.id ?? null;
}

export function resolveStaffActorRoleForStudio(
  ctx: AccessContext,
  studioId: string,
): StaffRole | null {
  if (ctx.isSuperAdmin) return "owner";
  const roles = new Set(
    ctx.memberships
      .filter((membership) => membership.studio_id === studioId)
      .map((membership) => membership.role),
  );
  if (roles.has("owner")) return "owner";
  if (roles.has("manager")) return "manager";
  if (roles.has("frontdesk")) return "frontdesk";
  return null;
}

export async function resolveSessionActorRole(params: {
  admin: AdminClient;
  ctx: AccessContext;
  userEmail: string | null | undefined;
  studioId: string;
  classInstructorId: string | null | undefined;
}): Promise<StaffRole | null> {
  if (hasStudioRole(params.ctx, params.studioId, ["owner", "manager", "frontdesk"])) {
    return resolveStaffActorRoleForStudio(params.ctx, params.studioId) ?? bestRole(params.ctx);
  }
  if (!hasInstructorRole(params.ctx)) {
    return null;
  }
  const instructorId = await resolveInstructorIdForEmail(params.admin, params.userEmail);
  if (!instructorId || !params.classInstructorId || instructorId !== params.classInstructorId) {
    return null;
  }
  return "instructor";
}

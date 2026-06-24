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

export async function resolveSessionActorRole(params: {
  admin: AdminClient;
  ctx: AccessContext;
  userEmail: string | null | undefined;
  studioId: string;
  classInstructorId: string | null | undefined;
}): Promise<StaffRole | null> {
  if (hasStudioRole(params.ctx, params.studioId, ["owner", "manager", "frontdesk"])) {
    return bestRole(params.ctx);
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

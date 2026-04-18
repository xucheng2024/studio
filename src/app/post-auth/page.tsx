import { redirect } from "next/navigation";
import { resolveAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ invite_token?: string }>;
};

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

async function acceptInviteIfNeeded(userId: string, email: string | null | undefined, token: string | undefined) {
  if (!token) return;
  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("staff_invites")
    .select("id, studio_id, location_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!invite) return;
  if (invite.status !== "pending") return;
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    await admin.from("staff_invites").update({ status: "expired" }).eq("id", invite.id);
    return;
  }
  if (normalizeEmail(invite.email) !== normalizeEmail(email)) return;

  const { data: existingMembership } = await admin
    .from("staff_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("studio_id", invite.studio_id)
    .eq("role", invite.role)
    .is("location_id", invite.location_id ?? null)
    .maybeSingle();

  if (existingMembership?.id) {
    await admin
      .from("staff_memberships")
      .update({ is_active: true, location_id: invite.location_id ?? null })
      .eq("id", existingMembership.id);
  } else {
    await admin.from("staff_memberships").insert({
      user_id: userId,
      studio_id: invite.studio_id,
      location_id: invite.location_id,
      role: invite.role,
      is_active: true,
    });
  }

  await admin
    .from("staff_invites")
    .update({
      status: "accepted",
      accepted_by: userId,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invite.id);
}

export default async function PostAuthPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth");
  }

  await acceptInviteIfNeeded(user.id, user.email, sp.invite_token);
  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  if (access.ctx.isSuperAdmin) {
    redirect("/dashboard/settings/owners");
  }
  if (!access.hasBackofficeAccess && access.hasSuspendedBackofficeAccess) {
    redirect("/account/suspended");
  }
  if (access.bestRole === "instructor") {
    redirect("/instructor/sessions");
  }
  redirect(access.hasBackofficeAccess ? "/dashboard/operations" : "/booking");
}

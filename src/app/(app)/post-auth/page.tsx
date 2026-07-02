import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { normalizeStudioSlug } from "@/lib/slug";
import { resolveAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ invite_token?: string; staff_portal?: string }>;
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

async function acceptPendingOwnerInviteIfNeeded(userId: string, email: string | null | undefined) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("platform_owner_email_invites")
    .select("id, invited_by, is_active, studio_limit")
    .eq("email", normalizedEmail)
    .eq("is_active", true)
    .maybeSingle();
  if (!invite?.id) return;

  await admin
    .from("platform_owner_grants")
    .upsert(
      {
        user_id: userId,
        is_active: true,
        studio_limit: invite.studio_limit,
        created_by: invite.invited_by ?? userId,
      },
      { onConflict: "user_id" },
    );

  await admin
    .from("platform_owner_email_invites")
    .update({
      is_active: false,
      accepted_user_id: userId,
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invite.id);
}

export default async function PostAuthPage({ searchParams }: Props) {
  const sp = await searchParams;
  const fromStaffPortal = sp.staff_portal === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("phone")
    .eq("id", user.id)
    .maybeSingle();

  await acceptInviteIfNeeded(user.id, user.email, sp.invite_token);
  await acceptPendingOwnerInviteIfNeeded(user.id, user.email);
  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  if (access.ctx.isSuperAdmin) {
    redirect("/dashboard/settings/owners");
  }
  if (!access.hasBackofficeAccess && access.hasSuspendedBackofficeAccess) {
    redirect("/account/suspended");
  }
  if (fromStaffPortal && !access.hasBackofficeAccess) {
    redirect("/account/access-required");
  }
  const hasBackofficeDashboardRole =
    access.ctx.isSuperAdmin ||
    access.ctx.roles.has("owner") ||
    access.ctx.roles.has("manager") ||
    access.ctx.roles.has("frontdesk");
  const c = await cookies();
  const studioSlug = normalizeStudioSlug(c.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? "");
  const nextPath =
    access.ctx.roles.has("instructor") && !hasBackofficeDashboardRole
      ? "/instructor/sessions"
      : access.hasBackofficeAccess
        ? "/dashboard/operations"
        : studioSlug
          ? `/${studioSlug}`
          : "/";

  if (!profile?.phone?.trim()) {
    redirect(`/account/complete-profile?next=${encodeURIComponent(nextPath)}`);
  }

  redirect(nextPath);
}

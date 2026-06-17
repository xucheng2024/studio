"use server";

import {
  revalidateDashboardClientViews,
  revalidateDashboardSettings,
  revalidateDashboardStaffViews,
  revalidateRbacCache,
} from "@/lib/revalidatePublic";
import { redirect } from "next/navigation";
import { isStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertLocationInStudio,
  hasStudioRole,
  requireOwnedStudioAccess,
  requireStudio,
  requireUser,
} from "./shared";

export async function updateMemberProfile(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const fullNameRaw = String(formData.get("full_name") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const notesRaw = String(formData.get("notes") ?? "").trim();
  const full_name = fullNameRaw || null;
  const phone = phoneRaw || null;
  const notes = notesRaw || null;

  if (!studioId || !clientId) {
    redirect("/dashboard/clients?member_error=invalid_input");
  }
  const { studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) {
    redirect("/dashboard/clients?member_error=studio_not_found");
  }
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager", "frontdesk"])) {
    redirect(`/dashboard/clients/${clientId}?studio_id=${studio.id}${locationId ? `&location_id=${locationId}` : ""}&member_error=forbidden`);
  }

  const admin = createAdminClient();
  const { data: inScopeMember } = await admin
    .from("member_studio_memberships")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("user_id", clientId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!inScopeMember) {
    redirect(`/dashboard/clients/${clientId}?studio_id=${studio.id}${locationId ? `&location_id=${locationId}` : ""}&member_error=out_of_scope`);
  }

  const { error } = await admin
    .from("user_profiles")
    .upsert({
      id: clientId,
      full_name,
      phone,
      notes,
    });
  if (error) {
    redirect(`/dashboard/clients/${clientId}?studio_id=${studio.id}${locationId ? `&location_id=${locationId}` : ""}&member_error=save_failed`);
  }

  revalidateDashboardClientViews(clientId);
  redirect(`/dashboard/clients/${clientId}?studio_id=${studio.id}${locationId ? `&location_id=${locationId}` : ""}&member_saved=1`);
}

export async function createStaffMembership(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "").trim();
  const locationRaw = String(formData.get("location_id") ?? "").trim();
  const locationId = locationRaw || null;
  const { supabase, studio, user } = await requireStudio(studioId || undefined);
  if (!studio || !email || !role) {
    redirect("/dashboard/staff?staff_error=missing_required_fields");
  }
  if (isStudioContractSuspended(studio)) {
    redirect("/dashboard/staff?staff_error=studio_suspended");
  }

  await requireOwnedStudioAccess(supabase, studio.id, user.id, "/dashboard/staff?staff_error=forbidden");
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) {
    redirect("/dashboard/staff?staff_error=invalid_location_scope");
  }

  const { data: targetUser } = await supabase
    .from("users")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();
  if (!targetUser?.id) {
    redirect("/dashboard/staff?staff_error=user_not_found_by_email");
  }
  if (targetUser.id === user.id && role !== "owner") {
    redirect("/dashboard/staff?staff_error=cannot_assign_self_non_owner");
  }
  if (!["manager", "frontdesk", "instructor", "owner"].includes(role)) {
    redirect("/dashboard/staff?staff_error=invalid_role");
  }

  const { data: existing } = await supabase
    .from("staff_memberships")
    .select("id")
    .eq("user_id", targetUser.id)
    .eq("studio_id", studio.id)
    .eq("role", role)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("staff_memberships")
      .update({
        location_id: locationId,
        is_active: true,
      })
      .eq("id", existing.id);
    if (error) {
      redirect("/dashboard/staff?staff_error=update_membership_failed");
    }
  } else {
    const { error } = await supabase.from("staff_memberships").insert({
      user_id: targetUser.id,
      studio_id: studio.id,
      location_id: locationId,
      role,
      is_active: true,
    });
    if (error) {
      redirect("/dashboard/staff?staff_error=create_membership_failed");
    }
  }

  revalidateDashboardStaffViews();
  revalidateRbacCache();
  redirect("/dashboard/staff?staff_msg=staff_membership_saved");
}

export async function toggleStaffMembership(formData: FormData): Promise<void> {
  const membershipId = String(formData.get("membership_id") ?? "");
  const nextActive = formData.get("next_active") === "true";
  const { supabase, user } = await requireUser();
  if (!membershipId) return;

  const { data: membership } = await supabase
    .from("staff_memberships")
    .select("id, studio_id, role")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return;

  const studio = await requireOwnedStudioAccess(supabase, membership.studio_id, user.id, "/dashboard/staff?staff_error=forbidden");
  if (isStudioContractSuspended(studio)) return;
  if (membership.role === "owner") return;

  await supabase
    .from("staff_memberships")
    .update({ is_active: nextActive })
    .eq("id", membership.id);

  revalidateDashboardStaffViews();
  revalidateRbacCache();
}

export async function createStaffInvite(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationRaw = String(formData.get("location_id") ?? "").trim();
  const locationId = locationRaw || null;
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "").trim();
  const { supabase, studio, user } = await requireStudio(studioId || undefined);
  if (!studio || !email || !role) {
    redirect("/dashboard/settings/staff-invites?invite_error=missing_required_fields");
  }
  if (isStudioContractSuspended(studio)) {
    redirect("/dashboard/settings/staff-invites?invite_error=studio_suspended");
  }
  if (!["manager", "frontdesk", "instructor"].includes(role)) {
    redirect("/dashboard/settings/staff-invites?invite_error=invalid_role");
  }
  await requireOwnedStudioAccess(supabase, studio.id, user.id, "/dashboard/settings/staff-invites?invite_error=forbidden");
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) {
    redirect("/dashboard/settings/staff-invites?invite_error=invalid_location_scope");
  }

  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("staff_invites").insert({
    studio_id: studio.id,
    location_id: locationId,
    email,
    role,
    token,
    status: "pending",
    expires_at: expiresAt,
    invited_by: user.id,
  });
  if (error) {
    redirect("/dashboard/settings/staff-invites?invite_error=create_failed");
  }
  revalidateDashboardSettings("staff-invites");
  revalidateRbacCache();
  redirect("/dashboard/settings/staff-invites?invite_success=sent");
}

export async function revokeStaffInvite(formData: FormData): Promise<void> {
  const inviteId = String(formData.get("invite_id") ?? "");
  const { supabase, user } = await requireUser();
  if (!inviteId) return;

  const { data: invite } = await supabase
    .from("staff_invites")
    .select("id, studio_id, status")
    .eq("id", inviteId)
    .maybeSingle();
  if (!invite || invite.status !== "pending") return;
  await requireOwnedStudioAccess(supabase, invite.studio_id, user.id, "/dashboard/settings/staff-invites?invite_error=forbidden");

  await supabase.from("staff_invites").update({ status: "revoked" }).eq("id", invite.id);
  revalidateDashboardSettings("staff-invites");
  revalidateRbacCache();
}

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
  DashboardFormResult,
  err,
  hasStudioRole,
  ok,
  requireOwnedStudioAccess,
  requireStudio,
  requireUser,
} from "./shared";

export async function updateMemberProfile(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const fullNameRaw = String(formData.get("full_name") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const notesRaw = String(formData.get("notes") ?? "").trim();
  const full_name = fullNameRaw || null;
  const phone = phoneRaw || null;
  const notes = notesRaw || null;

  if (!studioId || !clientId) return err("Missing required client or studio.");
  const { studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager", "frontdesk"])) {
    return err("You do not have access to update this profile.");
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
  if (!inScopeMember) return err("This user is not in the selected studio scope.");
  if (!ctx.hasAnyGlobalLocationAccess) {
    if (!locationId) return err("You do not have access to update this profile.");
    const [bookingHit, packageHit, subscriptionHit, paymentHit] = await Promise.all([
      admin
        .from("bookings")
        .select("id, class_sessions!inner(location_id, classes!inner(studio_id))")
        .eq("client_id", clientId)
        .eq("class_sessions.location_id", locationId)
        .eq("class_sessions.classes.studio_id", studio.id)
        .limit(1)
        .maybeSingle(),
      admin
        .from("client_packages")
        .select("id, packages!inner(studio_id, location_id)")
        .eq("client_id", clientId)
        .eq("packages.studio_id", studio.id)
        .or(`packages.location_id.is.null,packages.location_id.eq.${locationId}`)
        .limit(1)
        .maybeSingle(),
      admin
        .from("customer_subscriptions")
        .select("id, membership_products!inner(studio_id, location_id)")
        .eq("client_id", clientId)
        .eq("studio_id", studio.id)
        .or(`membership_products.location_id.is.null,membership_products.location_id.eq.${locationId}`)
        .limit(1)
        .maybeSingle(),
      admin
        .from("payments")
        .select("id")
        .eq("client_id", clientId)
        .eq("studio_id", studio.id)
        .eq("location_id", locationId)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!bookingHit.data && !packageHit.data && !subscriptionHit.data && !paymentHit.data) {
      return err("This user is outside your location scope.");
    }
  }

  const { error } = await admin
    .from("user_profiles")
    .upsert({
      id: clientId,
      full_name,
      phone,
      notes,
    });
  if (error) return err("Could not save profile.");

  revalidateDashboardClientViews(clientId);
  return ok("Profile saved.");
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

  const admin = createAdminClient();
  const { data: targetUser } = await admin
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

  const { data: existing } = await admin
    .from("staff_memberships")
    .select("id")
    .eq("user_id", targetUser.id)
    .eq("studio_id", studio.id)
    .eq("role", role)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
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
    const { error } = await admin.from("staff_memberships").insert({
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

export async function toggleStaffMembership(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const membershipId = String(formData.get("membership_id") ?? "");
  const nextActive = formData.get("next_active") === "true";
  const { supabase, user } = await requireUser();
  if (!membershipId) return err("Missing staff membership.");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("staff_memberships")
    .select("id, studio_id, role")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return err("Staff membership not found.");

  const studio = await requireOwnedStudioAccess(supabase, membership.studio_id, user.id, "/dashboard/staff?staff_error=forbidden");
  if (isStudioContractSuspended(studio)) return err("This studio is suspended. Resume the contract before changing staff access.");
  if (membership.role === "owner") return err("Owner access cannot be disabled here.");

  const { error } = await admin
    .from("staff_memberships")
    .update({ is_active: nextActive })
    .eq("id", membership.id);
  if (error) return err("Could not update staff access.");

  revalidateDashboardStaffViews();
  revalidateRbacCache();
  return ok(nextActive ? "Staff member enabled." : "Staff member disabled.");
}

export async function createStaffInvite(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationRaw = String(formData.get("location_id") ?? "").trim();
  const locationId = locationRaw || null;
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "").trim();
  const { supabase, studio, user } = await requireStudio(studioId || undefined);
  if (!studio || !email || !role) return err("Please complete email, role, and studio.");
  if (isStudioContractSuspended(studio)) return err("This studio is suspended. Set contract to active before sending invites.");
  if (!["manager", "frontdesk", "instructor"].includes(role)) return err("Invalid role.");
  await requireOwnedStudioAccess(supabase, studio.id, user.id, "/dashboard/settings/staff-invites?invite_error=forbidden");
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) return err("Location does not belong to the selected studio.");

  const admin = createAdminClient();
  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from("staff_invites").insert({
    studio_id: studio.id,
    location_id: locationId,
    email,
    role,
    token,
    status: "pending",
    expires_at: expiresAt,
    invited_by: user.id,
  });
  if (error) return err("Could not create invite. An active invite may already exist.");
  revalidateDashboardSettings("staff-invites");
  revalidateRbacCache();
  return ok("Invite created.");
}

export async function revokeStaffInvite(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const inviteId = String(formData.get("invite_id") ?? "");
  const { supabase, user } = await requireUser();
  if (!inviteId) return err("Missing invite.");

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("staff_invites")
    .select("id, studio_id, status")
    .eq("id", inviteId)
    .maybeSingle();
  if (!invite || invite.status !== "pending") return err("Pending invite not found.");
  await requireOwnedStudioAccess(supabase, invite.studio_id, user.id, "/dashboard/settings/staff-invites?invite_error=forbidden");

  const { error } = await admin.from("staff_invites").update({ status: "revoked" }).eq("id", invite.id);
  if (error) return err("Could not revoke invite.");
  revalidateDashboardSettings("staff-invites");
  revalidateRbacCache();
  return ok("Invite revoked.");
}

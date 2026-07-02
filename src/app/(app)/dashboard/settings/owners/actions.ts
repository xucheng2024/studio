"use server";

import {
  revalidateDashboardCoreViews,
  revalidateDashboardSettings,
  revalidatePublicStudioPath,
  revalidateRbacCache,
} from "@/lib/revalidatePublic";
import { redirect } from "next/navigation";
import { err, ok, type DashboardFormResult } from "@/app/(app)/dashboard/_actions/shared";
import { writeOperationAudit } from "@/lib/audit";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseStudioLimit(raw: FormDataEntryValue | null) {
  const value = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isSuperAdminEmail(user.email)) return { user: null, error: err("You do not have access to this action.") };
  return { user, error: null };
}

export async function grantOwnerAccessByEmail(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!email) return err("Please enter a valid email.");
  const studioLimit = parseStudioLimit(formData.get("studio_limit"));
  if (!studioLimit) return err("Studio limit must be at least 1.");

  const admin = createAdminClient();
  const { data: target } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!target?.id) {
    const nowIso = new Date().toISOString();
    const { data: beforeInvite } = await admin
      .from("platform_owner_email_invites")
      .select("id, email, is_active, invited_by, accepted_user_id, accepted_at, studio_limit")
      .eq("email", email)
      .maybeSingle();
    const { error: inviteErr } = await admin
      .from("platform_owner_email_invites")
      .upsert(
        {
          email,
          is_active: true,
          invited_by: user.id,
          accepted_user_id: null,
          accepted_at: null,
          studio_limit: studioLimit,
          updated_at: nowIso,
        },
        { onConflict: "email" },
      );
    if (inviteErr) return err("Could not save changes.");
    await writeOperationAudit({
      actorId: user.id,
      actorRole: "superadmin",
      action: "owner_invite_pending_enabled",
      targetType: "owner_invite",
      targetId: email,
      beforeState: beforeInvite ?? null,
      afterState: { email, is_active: true, studio_limit: studioLimit },
    });
    revalidateDashboardSettings("owners");
    revalidateRbacCache();
    return ok("Owner invite saved. Access will be granted automatically after first sign-in.");
  }

  const { data: beforeRow } = await admin
    .from("platform_owner_grants")
    .select("user_id, is_active, studio_limit")
    .eq("user_id", target.id)
    .maybeSingle();

  const { error } = await admin
    .from("platform_owner_grants")
    .upsert({ user_id: target.id, is_active: true, studio_limit: studioLimit, created_by: user.id }, { onConflict: "user_id" });
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "owner_grant_enabled",
    targetType: "owner",
    targetId: target.id,
    beforeState: beforeRow ?? null,
    afterState: { user_id: target.id, is_active: true, studio_limit: studioLimit },
  });
  await admin
    .from("platform_owner_email_invites")
    .update({
      is_active: false,
      accepted_user_id: target.id,
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("email", email);

  revalidateDashboardSettings("owners");
  revalidateRbacCache();
  return ok("Owner workspace access granted.");
}

export async function updateOwnerStudioLimit(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const userId = String(formData.get("user_id") ?? "").trim();
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!userId || !UUID_RE.test(userId)) return err("Invalid user reference.");
  const studioLimit = parseStudioLimit(formData.get("studio_limit"));
  if (!studioLimit) return err("Studio limit must be at least 1.");

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_grants")
    .select("user_id, is_active, studio_limit")
    .eq("user_id", userId)
    .maybeSingle();
  if (!beforeRow?.user_id) return err("Owner grant not found.");

  const { error } = await admin
    .from("platform_owner_grants")
    .update({ studio_limit: studioLimit })
    .eq("user_id", userId);
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "owner_grant_limit_updated",
    targetType: "owner",
    targetId: userId,
    beforeState: beforeRow,
    afterState: { ...beforeRow, studio_limit: studioLimit },
  });

  revalidateDashboardCoreViews();
  revalidateDashboardSettings("owners");
  revalidateRbacCache();
  return ok("Owner studio limit updated.");
}

/** Toggle platform owner grant only (FormData: user_id, is_active = "true"|"false" desired next state). */
export async function setOwnerGrantStatus(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const userId = String(formData.get("user_id") ?? "").trim();
  const nextActive = String(formData.get("is_active") ?? "").trim() === "true";
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!userId || !UUID_RE.test(userId)) return err("Invalid user reference.");

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_grants")
    .select("user_id, is_active, studio_limit")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await admin
    .from("platform_owner_grants")
    .upsert(
      { user_id: userId, is_active: nextActive, studio_limit: beforeRow?.studio_limit ?? 1, created_by: user.id },
      { onConflict: "user_id" },
    );
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: nextActive ? "owner_grant_enabled" : "owner_grant_disabled",
    targetType: "owner",
    targetId: userId,
    beforeState: beforeRow ?? null,
    afterState: { user_id: userId, is_active: nextActive, studio_limit: beforeRow?.studio_limit ?? 1 },
  });

  revalidateDashboardSettings("owners");
  revalidateRbacCache();
  return ok(nextActive ? "Owner grant enabled." : "Owner grant disabled.");
}

export async function updateOwnerInviteStudioLimit(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!inviteId || !UUID_RE.test(inviteId)) return err("Invite not found.");
  const studioLimit = parseStudioLimit(formData.get("studio_limit"));
  if (!studioLimit) return err("Studio limit must be at least 1.");

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_email_invites")
    .select("id, email, is_active, accepted_user_id, accepted_at, studio_limit")
    .eq("id", inviteId)
    .maybeSingle();
  if (!beforeRow) return err("Invite not found.");
  if (beforeRow.accepted_user_id) return err("This invite has already been accepted. Update the owner grant instead.");

  const { error } = await admin
    .from("platform_owner_email_invites")
    .update({
      studio_limit: studioLimit,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inviteId);
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "owner_invite_limit_updated",
    targetType: "owner_invite",
    targetId: inviteId,
    beforeState: beforeRow,
    afterState: { ...beforeRow, studio_limit: studioLimit },
  });

  revalidateDashboardSettings("owners");
  revalidateRbacCache();
  return ok("Owner invite studio limit updated.");
}

export async function suspendStudio(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!studioId || !UUID_RE.test(studioId)) return err("Studio not found.");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("studios")
    .select("id, owner_id, name, public_slug, contract_status, contract_ends_at")
    .eq("id", studioId)
    .maybeSingle();
  if (!row) return err("Studio not found.");

  const beforeState = {
    contract_status: row.contract_status,
    contract_ends_at: row.contract_ends_at,
  };

  const { error } = await admin.from("studios").update({ contract_status: "suspended" }).eq("id", studioId);
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "studio_suspended",
    targetType: "studio",
    targetId: studioId,
    beforeState,
    afterState: { contract_status: "suspended", owner_id: row.owner_id },
  });

  revalidateDashboardCoreViews();
  revalidateDashboardSettings("owners");
  revalidatePublicStudioPath(row.public_slug);
  revalidateRbacCache();
  return ok("Studio suspended.");
}

export async function resumeStudio(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const endsRaw = String(formData.get("contract_ends_at") ?? "").trim();
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!studioId || !UUID_RE.test(studioId)) return err("Studio not found.");

  let contract_ends_at: string | null = null;
  if (endsRaw) {
    const d = new Date(endsRaw);
    if (Number.isNaN(d.getTime())) return err("Invalid contract end date.");
    contract_ends_at = d.toISOString();
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("studios")
    .select("id, owner_id, name, public_slug, contract_status, contract_ends_at")
    .eq("id", studioId)
    .maybeSingle();
  if (!row) return err("Studio not found.");

  const beforeState = {
    contract_status: row.contract_status,
    contract_ends_at: row.contract_ends_at,
  };

  const patch: { contract_status: string; contract_ends_at?: string | null } = {
    contract_status: "active",
  };
  if (endsRaw) {
    patch.contract_ends_at = contract_ends_at;
  }

  const { error } = await admin.from("studios").update(patch).eq("id", studioId);
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "studio_resumed",
    targetType: "studio",
    targetId: studioId,
    beforeState,
    afterState: {
      contract_status: "active",
      contract_ends_at: contract_ends_at ?? row.contract_ends_at,
      owner_id: row.owner_id,
    },
  });

  revalidateDashboardCoreViews();
  revalidateDashboardSettings("owners");
  revalidatePublicStudioPath(row.public_slug);
  revalidateRbacCache();
  return ok("Studio resumed.");
}

export async function disableOwnerAndSuspendStudios(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const ownerUserId = String(formData.get("owner_user_id") ?? "").trim();
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!ownerUserId || !UUID_RE.test(ownerUserId)) return err("Invalid user reference.");

  const admin = createAdminClient();
  const { data: ownerUser } = await admin.from("users").select("id").eq("id", ownerUserId).maybeSingle();
  if (!ownerUser) return err("Owner not found.");

  const { data: beforeGrant } = await admin
    .from("platform_owner_grants")
    .select("user_id, is_active")
    .eq("user_id", ownerUserId)
    .maybeSingle();

  const { data: beforeStudios } = await admin
    .from("studios")
    .select("id, contract_status, name")
    .eq("owner_id", ownerUserId);

  const { data: rpcData, error: rpcError } = await admin.rpc("disable_owner_grant_and_suspend_studios", {
    p_owner_user_id: ownerUserId,
  });

  if (rpcError) return err("Bulk operation failed. Apply migration 021 or verify the RPC in Supabase.");
  const payload = rpcData as { ok?: boolean } | null;
  if (!payload || payload.ok === false) return err("Bulk operation failed. Apply migration 021 or verify the RPC in Supabase.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "owner_disabled_and_studios_suspended",
    targetType: "owner",
    targetId: ownerUserId,
    beforeState: {
      grant: beforeGrant ?? null,
      studios: beforeStudios ?? [],
    },
    afterState: payload,
  });

  revalidateDashboardCoreViews();
  revalidateDashboardSettings("owners");
  revalidateRbacCache();
  return ok("Owner grant disabled and all studios under this owner are now suspended.");
}

export async function setOwnerInviteStatus(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  const nextActive = String(formData.get("is_active") ?? "").trim() === "true";
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!inviteId || !UUID_RE.test(inviteId)) return err("Invite not found.");

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_email_invites")
    .select("id, email, is_active, accepted_user_id, accepted_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (!beforeRow) return err("Invite not found.");

  const { error } = await admin
    .from("platform_owner_email_invites")
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inviteId);
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: nextActive ? "owner_invite_reenabled" : "owner_invite_cancelled",
    targetType: "owner_invite",
    targetId: inviteId,
    beforeState: beforeRow,
    afterState: {
      ...beforeRow,
      is_active: nextActive,
    },
  });

  revalidateDashboardSettings("owners");
  revalidateRbacCache();
  return ok(nextActive ? "Owner invite re-enabled." : "Owner invite cancelled.");
}

export async function deleteOwnerInvite(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  const { user, error: authError } = await requireSuperAdmin();
  if (authError || !user) return authError ?? err("You do not have access to this action.");
  if (!inviteId || !UUID_RE.test(inviteId)) return err("Invite not found.");

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_email_invites")
    .select("id, email, is_active, accepted_user_id, accepted_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (!beforeRow) return err("Invite not found.");

  const { error } = await admin.from("platform_owner_email_invites").delete().eq("id", inviteId);
  if (error) return err("Could not save changes.");

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "owner_invite_deleted",
    targetType: "owner_invite",
    targetId: inviteId,
    beforeState: beforeRow,
    afterState: null,
  });

  revalidateDashboardSettings("owners");
  revalidateRbacCache();
  return ok("Owner invite deleted.");
}

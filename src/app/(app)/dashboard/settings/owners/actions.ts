"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeOperationAudit } from "@/lib/audit";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isSuperAdminEmail(user.email)) {
    redirect("/dashboard/settings/owners?owners_error=forbidden");
  }
  return { user };
}

export async function grantOwnerAccessByEmail(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const { user } = await requireSuperAdmin();
  if (!email) {
    redirect("/dashboard/settings/owners?owners_error=invalid_email");
  }

  const admin = createAdminClient();
  const { data: target } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!target?.id) {
    const nowIso = new Date().toISOString();
    const { data: beforeInvite } = await admin
      .from("platform_owner_email_invites")
      .select("id, email, is_active, invited_by, accepted_user_id, accepted_at")
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
          updated_at: nowIso,
        },
        { onConflict: "email" },
      );
    if (inviteErr) {
      redirect("/dashboard/settings/owners?owners_error=save_failed");
    }
    await writeOperationAudit({
      actorId: user.id,
      actorRole: "superadmin",
      action: "owner_invite_pending_enabled",
      targetType: "owner_invite",
      targetId: email,
      beforeState: beforeInvite ?? null,
      afterState: { email, is_active: true },
    });
    revalidatePath("/dashboard/settings/owners");
    redirect("/dashboard/settings/owners?owners_success=invite_pending");
  }

  const { data: beforeRow } = await admin
    .from("platform_owner_grants")
    .select("user_id, is_active")
    .eq("user_id", target.id)
    .maybeSingle();

  const { error } = await admin
    .from("platform_owner_grants")
    .upsert({ user_id: target.id, is_active: true, created_by: user.id }, { onConflict: "user_id" });
  if (error) {
    redirect("/dashboard/settings/owners?owners_error=save_failed");
  }

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "owner_grant_enabled",
    targetType: "owner",
    targetId: target.id,
    beforeState: beforeRow ?? null,
    afterState: { user_id: target.id, is_active: true },
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

  revalidatePath("/dashboard/settings/owners");
  redirect("/dashboard/settings/owners?owners_success=grant_email");
}

/** Toggle platform owner grant only (FormData: user_id, is_active = "true"|"false" desired next state). */
export async function setOwnerGrantStatus(formData: FormData): Promise<void> {
  const userId = String(formData.get("user_id") ?? "").trim();
  const nextActive = String(formData.get("is_active") ?? "").trim() === "true";
  const { user } = await requireSuperAdmin();
  if (!userId || !UUID_RE.test(userId)) {
    redirect("/dashboard/settings/owners?owners_error=invalid_user");
  }

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_grants")
    .select("user_id, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await admin
    .from("platform_owner_grants")
    .upsert(
      { user_id: userId, is_active: nextActive, created_by: user.id },
      { onConflict: "user_id" },
    );
  if (error) {
    redirect("/dashboard/settings/owners?owners_error=save_failed");
  }

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: nextActive ? "owner_grant_enabled" : "owner_grant_disabled",
    targetType: "owner",
    targetId: userId,
    beforeState: beforeRow ?? null,
    afterState: { user_id: userId, is_active: nextActive },
  });

  revalidatePath("/dashboard/settings/owners");
  redirect(`/dashboard/settings/owners?owners_success=${nextActive ? "grant_on" : "grant_off"}`);
}

export async function suspendStudio(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const { user } = await requireSuperAdmin();
  if (!studioId || !UUID_RE.test(studioId)) {
    redirect("/dashboard/settings/owners?owners_error=invalid_studio");
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("studios")
    .select("id, owner_id, name, public_slug, contract_status, contract_ends_at")
    .eq("id", studioId)
    .maybeSingle();
  if (!row) {
    redirect("/dashboard/settings/owners?owners_error=unknown_studio");
  }

  const beforeState = {
    contract_status: row.contract_status,
    contract_ends_at: row.contract_ends_at,
  };

  const { error } = await admin.from("studios").update({ contract_status: "suspended" }).eq("id", studioId);
  if (error) {
    redirect("/dashboard/settings/owners?owners_error=save_failed");
  }

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "studio_suspended",
    targetType: "studio",
    targetId: studioId,
    beforeState,
    afterState: { contract_status: "suspended", owner_id: row.owner_id },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/overview");
  revalidatePath("/dashboard/operations");
  revalidatePath("/dashboard/settings/owners");
  redirect("/dashboard/settings/owners?owners_success=studio_suspended");
}

export async function resumeStudio(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const endsRaw = String(formData.get("contract_ends_at") ?? "").trim();
  const { user } = await requireSuperAdmin();
  if (!studioId || !UUID_RE.test(studioId)) {
    redirect("/dashboard/settings/owners?owners_error=invalid_studio");
  }

  let contract_ends_at: string | null = null;
  if (endsRaw) {
    const d = new Date(endsRaw);
    if (Number.isNaN(d.getTime())) {
      redirect("/dashboard/settings/owners?owners_error=invalid_date");
    }
    contract_ends_at = d.toISOString();
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("studios")
    .select("id, owner_id, name, public_slug, contract_status, contract_ends_at")
    .eq("id", studioId)
    .maybeSingle();
  if (!row) {
    redirect("/dashboard/settings/owners?owners_error=unknown_studio");
  }

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
  if (error) {
    redirect("/dashboard/settings/owners?owners_error=save_failed");
  }

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

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/overview");
  revalidatePath("/dashboard/operations");
  revalidatePath("/dashboard/settings/owners");
  redirect("/dashboard/settings/owners?owners_success=studio_resumed");
}

export async function disableOwnerAndSuspendStudios(formData: FormData): Promise<void> {
  const ownerUserId = String(formData.get("owner_user_id") ?? "").trim();
  const { user } = await requireSuperAdmin();
  if (!ownerUserId || !UUID_RE.test(ownerUserId)) {
    redirect("/dashboard/settings/owners?owners_error=invalid_user");
  }

  const admin = createAdminClient();
  const { data: ownerUser } = await admin.from("users").select("id").eq("id", ownerUserId).maybeSingle();
  if (!ownerUser) {
    redirect("/dashboard/settings/owners?owners_error=unknown_owner");
  }

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

  if (rpcError) {
    redirect("/dashboard/settings/owners?owners_error=rpc_failed");
  }
  const payload = rpcData as { ok?: boolean } | null;
  if (!payload || payload.ok === false) {
    redirect("/dashboard/settings/owners?owners_error=rpc_failed");
  }

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

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/overview");
  revalidatePath("/dashboard/operations");
  revalidatePath("/dashboard/settings/owners");
  redirect("/dashboard/settings/owners?owners_success=disable_owner_suspend_all");
}

export async function setOwnerInviteStatus(formData: FormData): Promise<void> {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  const nextActive = String(formData.get("is_active") ?? "").trim() === "true";
  const { user } = await requireSuperAdmin();
  if (!inviteId || !UUID_RE.test(inviteId)) {
    redirect("/dashboard/settings/owners?owners_error=invalid_invite");
  }

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_email_invites")
    .select("id, email, is_active, accepted_user_id, accepted_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (!beforeRow) {
    redirect("/dashboard/settings/owners?owners_error=invalid_invite");
  }

  const { error } = await admin
    .from("platform_owner_email_invites")
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inviteId);
  if (error) {
    redirect("/dashboard/settings/owners?owners_error=save_failed");
  }

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

  revalidatePath("/dashboard/settings/owners");
  redirect(`/dashboard/settings/owners?owners_success=${nextActive ? "invite_reenabled" : "invite_cancelled"}`);
}

export async function deleteOwnerInvite(formData: FormData): Promise<void> {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  const { user } = await requireSuperAdmin();
  if (!inviteId || !UUID_RE.test(inviteId)) {
    redirect("/dashboard/settings/owners?owners_error=invalid_invite");
  }

  const admin = createAdminClient();
  const { data: beforeRow } = await admin
    .from("platform_owner_email_invites")
    .select("id, email, is_active, accepted_user_id, accepted_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (!beforeRow) {
    redirect("/dashboard/settings/owners?owners_error=invalid_invite");
  }

  const { error } = await admin.from("platform_owner_email_invites").delete().eq("id", inviteId);
  if (error) {
    redirect("/dashboard/settings/owners?owners_error=save_failed");
  }

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "superadmin",
    action: "owner_invite_deleted",
    targetType: "owner_invite",
    targetId: inviteId,
    beforeState: beforeRow,
    afterState: null,
  });

  revalidatePath("/dashboard/settings/owners");
  redirect("/dashboard/settings/owners?owners_success=invite_deleted");
}

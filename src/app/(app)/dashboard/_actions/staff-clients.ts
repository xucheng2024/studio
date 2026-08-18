"use server";

import { revalidatePath } from "next/cache";
import {
  revalidateDashboardClientViews,
  revalidateDashboardSettings,
  revalidateDashboardStaffViews,
  revalidateRbacCache,
} from "@/lib/revalidatePublic";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import {
  createOrLinkTreatmentFromCompletedAppointment,
  reviseTreatment,
  upsertTreatmentFollowUp,
  type TreatmentLifecycleStatus,
  type TreatmentFollowUpStatus,
} from "@/lib/salon-treatments";
import {
  anonymizeSalonCustomerRecord,
  completeSalonCustomerDataRequest,
  createSalonCustomerDataRequest,
  mutateSalonCustomerEmailConsent,
  mutateSalonCustomerPrivacyConsent,
  updateSalonCustomerCoreProfile,
  updateSalonCustomerHealthProfile,
  updateSalonCustomerPreferences,
} from "@/lib/salon-customer-sensitive";
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
  const { studio, ctx, user } = await requireStudio(studioId || undefined);
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
  if (!hasStudioGlobalLocationAccess(ctx, studio.id)) {
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

  const { data: salonRow } = await admin
    .from("salon_customers")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("user_id", clientId)
    .is("merged_into_id", null)
    .maybeSingle<{ id: string }>();
  if (salonRow?.id) {
    const salonResult = await updateSalonCustomerCoreProfile({
      userId: user.id,
      email: user.email ?? null,
      studioId: studio.id,
      customerId: salonRow.id,
      locationId,
      patch: { fullName: fullNameRaw || undefined, phone },
    });
    if (!salonResult.ok && salonResult.reason !== "not_found") {
      return err(salonResult.message ?? "Could not save studio customer record.");
    }
  }

  revalidateDashboardClientViews(clientId);
  return ok("Profile saved.");
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

export async function updateSalonCustomerPreferencesAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!studioId || !customerId) return err("Missing required customer or studio.");

  const { user } = await requireUser();
  const result = await updateSalonCustomerPreferences({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    locationId,
    reason,
    input: {
      preferredServices: String(formData.get("preferred_services") ?? ""),
      preferredEmployeeIds: String(formData.get("preferred_employee_ids") ?? ""),
      preferredLocationIds: String(formData.get("preferred_location_ids") ?? ""),
      preferredTimeSlots: String(formData.get("preferred_time_slots") ?? ""),
      communicationLanguage: String(formData.get("communication_language") ?? ""),
      productPreferences: String(formData.get("product_preferences") ?? ""),
      environmentPreferences: String(formData.get("environment_preferences") ?? ""),
      contactPreference: String(formData.get("contact_preference") ?? ""),
      notes: String(formData.get("preference_notes") ?? ""),
    },
  });

  if (!result.ok) return err(result.message ?? result.reason);

  revalidateDashboardClientViews(customerId);
  return ok("Preferences saved.");
}

export async function updateSalonCustomerHealthProfileAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!studioId || !customerId) return err("Missing required customer or studio.");

  const { user } = await requireUser();
  const result = await updateSalonCustomerHealthProfile({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    locationId,
    reason,
    input: {
      allergies: String(formData.get("allergies") ?? ""),
      reactionIngredients: String(formData.get("reaction_ingredients") ?? ""),
      reactionProducts: String(formData.get("reaction_products") ?? ""),
      declaredHealthConditions: String(formData.get("declared_health_conditions") ?? ""),
      serviceAffectingConditions: String(formData.get("service_affecting_conditions") ?? ""),
      contraindications: String(formData.get("contraindications") ?? ""),
      patchTestRequired: String(formData.get("patch_test_required") ?? "") === "true",
      patchTestDate: String(formData.get("patch_test_date") ?? ""),
      patchTestResult: String(formData.get("patch_test_result") ?? ""),
      lastConfirmedAt: String(formData.get("last_confirmed_at") ?? ""),
    },
  });

  if (!result.ok) return err(result.message ?? result.reason);

  revalidateDashboardClientViews(customerId);
  return ok("Health & safety profile saved.");
}

export async function recordSalonCustomerEmailConsentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const statusRaw = String(formData.get("consent_status") ?? "").trim();
  const sourceRaw = String(formData.get("consent_source") ?? "").trim();
  const textVersion = String(formData.get("consent_text_version") ?? "").trim();
  const occurredAt = String(formData.get("consent_occurred_at") ?? "").trim() || null;
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || crypto.randomUUID();

  if (!studioId || !customerId) return err("Missing required customer or studio.");
  if (statusRaw !== "granted" && statusRaw !== "withdrawn") return err("Invalid consent status.");
  if (!textVersion) return err("Consent text version is required.");

  const source = sourceRaw || "frontdesk";
  if (!["frontdesk", "client_portal", "imported", "system", "api"].includes(source)) {
    return err("Invalid consent source.");
  }

  const { user } = await requireUser();
  const result = await mutateSalonCustomerEmailConsent({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    locationId,
    idempotencyKey,
    input: {
      status: statusRaw,
      source: source as "frontdesk" | "client_portal" | "imported" | "system" | "api",
      textVersion,
      occurredAt,
      evidence: {
        note: String(formData.get("consent_evidence_note") ?? "").trim() || null,
      },
    },
  });

  if (!result.ok) return err(result.message);

  revalidateDashboardClientViews(customerId);
  return ok(`Consent recorded: ${result.effectiveStatus}.`);
}

export async function updateSalonCustomerCoreProfileAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!studioId || !customerId) return err("Missing required customer or studio.");
  const { user } = await requireUser();
  const result = await updateSalonCustomerCoreProfile({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    locationId,
    patch: {
      fullName: fullName || undefined,
      email,
      phone,
    },
  });
  if (!result.ok) return err(result.message ?? result.reason);
  revalidateDashboardClientViews(customerId);
  return ok("Customer record saved.");
}

export async function recordSalonCustomerPrivacyConsentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const statusRaw = String(formData.get("consent_status") ?? "").trim();
  const sourceRaw = String(formData.get("consent_source") ?? "").trim() || "frontdesk";
  const textVersion = String(formData.get("consent_text_version") ?? "").trim();
  const noticeVersionId = String(formData.get("privacy_notice_version_id") ?? "").trim() || null;

  if (!studioId || !customerId) return err("Missing required customer or studio.");
  if (statusRaw !== "granted" && statusRaw !== "withdrawn") return err("Invalid consent status.");
  if (!textVersion) return err("Publish a privacy notice version first.");
  if (!["frontdesk", "client_portal", "imported", "system", "api"].includes(sourceRaw)) {
    return err("Invalid consent source.");
  }

  const { user } = await requireUser();
  const result = await mutateSalonCustomerPrivacyConsent({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    locationId,
    input: {
      status: statusRaw,
      source: sourceRaw as "frontdesk" | "client_portal" | "imported" | "system" | "api",
      textVersion,
      noticeVersionId,
      evidenceNote: String(formData.get("consent_evidence_note") ?? "").trim() || null,
    },
  });
  if (!result.ok) return err(result.message);
  revalidateDashboardClientViews(customerId);
  return ok(`Privacy notice consent recorded: ${result.effectiveStatus}.`);
}

export async function createSalonCustomerDataRequestAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const requestType = String(formData.get("request_type") ?? "").trim();
  const customerNote = String(formData.get("customer_note") ?? "").trim() || null;

  if (!studioId || !customerId) return err("Missing required customer or studio.");
  if (requestType !== "access" && requestType !== "correction") return err("Invalid request type.");

  const { user } = await requireUser();
  const result = await createSalonCustomerDataRequest({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    locationId,
    requestType,
    customerNote,
  });
  if (!result.ok) return err(result.message ?? result.reason);
  revalidateDashboardClientViews(customerId);
  return ok("Data request recorded.");
}

export async function completeSalonCustomerDataRequestAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const statusRaw = String(formData.get("request_status") ?? "").trim();
  const staffNote = String(formData.get("staff_note") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!studioId || !customerId || !requestId) return err("Missing required request.");
  if (statusRaw !== "completed" && statusRaw !== "rejected") return err("Invalid close status.");
  if (!staffNote) return err("A staff note is required.");

  const { user } = await requireUser();
  if (statusRaw === "completed" && (fullName || email || phone)) {
    const profileResult = await updateSalonCustomerCoreProfile({
      userId: user.id,
      email: user.email ?? null,
      studioId,
      customerId,
      locationId,
      patch: {
        ...(fullName ? { fullName } : {}),
        ...(email || phone ? { email, phone } : {}),
      },
    });
    if (!profileResult.ok) return err(profileResult.message ?? profileResult.reason);
  }

  const result = await completeSalonCustomerDataRequest({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    requestId,
    locationId,
    status: statusRaw,
    staffNote,
  });
  if (!result.ok) return err(result.message ?? result.reason);
  revalidateDashboardClientViews(customerId);
  return ok(statusRaw === "completed" ? "Data request completed." : "Data request rejected.");
}

export async function anonymizeSalonCustomerAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  if (!studioId || !customerId) return err("Missing required customer or studio.");

  const { user } = await requireUser();
  const result = await anonymizeSalonCustomerRecord({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    customerId,
    locationId,
  });
  if (!result.ok) return err(result.message ?? result.reason);
  revalidateDashboardClientViews(customerId);
  revalidateDashboardSettings("privacy");
  return ok("Customer deactivated and masked.");
}

function getIdempotencyKey(formData: FormData, fieldName = "idempotency_key") {
  const raw = String(formData.get(fieldName) ?? "").trim();
  return raw || crypto.randomUUID();
}

function mapTreatmentError(code: string, fallback: string) {
  switch (code) {
    case "forbidden":
    case "scope_violation":
      return "You do not have permission for this treatment scope.";
    case "not_found":
      return "Treatment or appointment not found in current studio scope.";
    case "idempotency_in_progress":
      return "Same request is already being processed. Please retry shortly.";
    case "idempotency_conflict":
      return "Repeated request payload mismatch. Refresh and submit again.";
    case "idempotency_stale_claim":
      return "Request token expired. Please retry the action.";
    default:
      return fallback;
  }
}

export async function createOrLinkTreatmentFromAppointmentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const appointmentId = String(formData.get("appointment_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();

  if (!studioId || !appointmentId || !customerId) {
    return err("Missing required studio, customer or appointment.");
  }

  const { user } = await requireUser();
  const result = await createOrLinkTreatmentFromCompletedAppointment({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    appointmentId,
    actualEmployeeId: String(formData.get("actual_employee_id") ?? "").trim() || null,
    lifecycleStatus: (String(formData.get("lifecycle_status") ?? "").trim() || "open") as TreatmentLifecycleStatus,
    revisionReason: String(formData.get("revision_reason") ?? "").trim() || null,
    noteSummary: String(formData.get("note_summary") ?? "").trim() || null,
    sensitiveNoteBody: String(formData.get("sensitive_note_body") ?? "").trim() || null,
    followUpDueOn: String(formData.get("follow_up_due_on") ?? "").trim() || null,
    followUpOwnerEmployeeId: String(formData.get("follow_up_owner_employee_id") ?? "").trim() || null,
    followUpNoteSummary: String(formData.get("follow_up_note_summary") ?? "").trim() || null,
    idempotencyKey: getIdempotencyKey(formData),
  });

  if (!result.ok) {
    return err(mapTreatmentError(result.code, result.message || "Could not create treatment."));
  }

  revalidateDashboardClientViews(customerId);
  revalidatePath("/dashboard/clients/follow-ups");
  return ok(result.payload.alreadyLinked ? "Treatment already linked to appointment." : "Treatment created.");
}

export async function reviseTreatmentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const treatmentId = String(formData.get("treatment_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const lifecycleStatusRaw = String(formData.get("lifecycle_status") ?? "").trim();

  if (!studioId || !treatmentId || !customerId || !lifecycleStatusRaw) {
    return err("Missing required treatment revision fields.");
  }

  const { user } = await requireUser();
  const result = await reviseTreatment({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    treatmentId,
    lifecycleStatus: lifecycleStatusRaw as TreatmentLifecycleStatus,
    revisionReason: String(formData.get("revision_reason") ?? "").trim() || null,
    noteSummary: String(formData.get("note_summary") ?? "").trim() || null,
    sensitiveNoteBody: String(formData.get("sensitive_note_body") ?? "").trim() || null,
    idempotencyKey: getIdempotencyKey(formData),
  });

  if (!result.ok) {
    return err(mapTreatmentError(result.code, result.message || "Could not revise treatment."));
  }

  revalidateDashboardClientViews(customerId);
  return ok(`Treatment revised (#${result.payload.revisionNo}).`);
}

export async function upsertTreatmentFollowUpAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const treatmentId = String(formData.get("treatment_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();

  if (!studioId || !treatmentId || !customerId) {
    return err("Missing required follow-up fields.");
  }

  const statusRaw = String(formData.get("status") ?? "").trim();

  const { user } = await requireUser();
  const result = await upsertTreatmentFollowUp({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    treatmentId,
    followUpId: String(formData.get("follow_up_id") ?? "").trim() || null,
    dueOn: String(formData.get("due_on") ?? "").trim() || null,
    ownerEmployeeId: String(formData.get("owner_employee_id") ?? "").trim() || null,
    status: (statusRaw || null) as TreatmentFollowUpStatus | null,
    noteSummary: String(formData.get("note_summary") ?? "").trim() || null,
    idempotencyKey: getIdempotencyKey(formData),
  });

  if (!result.ok) {
    return err(mapTreatmentError(result.code, result.message || "Could not save follow-up."));
  }

  revalidateDashboardClientViews(customerId);
  revalidatePath("/dashboard/clients/follow-ups");
  return ok(`Follow-up saved (${result.payload.status}).`);
}

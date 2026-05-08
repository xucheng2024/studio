"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildAccessContext, resolveAccessContext } from "@/lib/rbac";
import { parsePublicTagsInput } from "@/lib/publicTags";
import { generateShareSlugSegment } from "@/lib/shareSlug";
import { normalizeStudioSlug } from "@/lib/slug";
import { isStudioContractSuspended } from "@/lib/studio-contract";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function requireStudio(requestedStudioId?: string) {
  const { supabase, user } = await requireUser();
  const ctx = await buildAccessContext(user.id, user.email ?? null, null);
  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  const studioId = requestedStudioId
    ? studioIds.includes(requestedStudioId)
      ? requestedStudioId
      : null
    : studioIds.length === 1
      ? studioIds[0]
      : null;
  if (!studioId) return { supabase, user, studio: null as null, ctx };

  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status, contract_ends_at")
    .eq("id", studioId)
    .maybeSingle();
  return { supabase, user, studio, ctx };
}

function hasStudioRole(
  ctx: Awaited<ReturnType<typeof requireStudio>>["ctx"],
  studioId: string,
  roles: Array<"owner" | "manager" | "frontdesk" | "instructor">,
) {
  return ctx.memberships.some(
    (m) => m.studio_id === studioId && roles.includes(m.role as (typeof roles)[number]),
  );
}

async function assertLocationInStudio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studioId: string,
  locationId: string | null,
) {
  if (!locationId) return true;
  const { data: loc } = await supabase
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(loc);
}

export async function createStudio(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  if (access.bestRole !== "owner" && !access.ctx.isSuperAdmin) {
    console.error("createStudio: only studio owners can create a venue");
    return;
  }

  if (!access.ctx.isSuperAdmin) {
    const admin = createAdminClient();
    const { data: grant } = await admin
      .from("platform_owner_grants")
      .select("is_active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!grant?.is_active) {
      redirect("/dashboard/overview?create_error=owner_grant_required");
    }
  }

  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("public_slug") ?? "");
  const public_slug = normalizeStudioSlug(slugRaw);
  if (!name || !public_slug) return;

  const { data: createdStudio, error } = await supabase
    .from("studios")
    .insert({
      name,
      owner_id: user.id,
      public_slug,
    })
    .select("id")
    .single();
  if (error || !createdStudio?.id) {
    console.error(error?.message ?? "create_studio_failed");
    return;
  }

  // Seed a default branch so Location-scoped pages are usable immediately.
  if (createdStudio?.id) {
    const { error: locErr } = await supabase.from("locations").insert({
      studio_id: createdStudio.id,
      name: "Main",
      is_active: true,
    });
    if (locErr) {
      // Do not fail studio creation if default location insert fails.
      console.error(`createStudio default location: ${locErr.message}`);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath(`/booking/${public_slug}`);
}

export async function updateStudioBasics(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner"])) return;

  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("public_slug") ?? "");
  const public_slug = normalizeStudioSlug(slugRaw);
  if (!name || !public_slug) return;

  const { error } = await supabase
    .from("studios")
    .update({ name, public_slug })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/overview");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/settings/public-profile");
  revalidatePath(`/booking/${public_slug}`);
  revalidatePath(`/booking/${studio.public_slug}`);
  revalidatePath(`/${public_slug}`);
  revalidatePath(`/${studio.public_slug}`);
}

export async function updateStudioHitpaySettings(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner"])) return;

  const enabled = formData.get("hitpay_enabled") === "on";
  const businessName = String(formData.get("hitpay_business_name") ?? "").trim() || null;
  const apiKeyInput = String(formData.get("hitpay_api_key") ?? "").trim();
  const webhookSaltInput = String(formData.get("hitpay_webhook_salt") ?? "").trim();
  const admin = createAdminClient();
  const { data: existingSecrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key, hitpay_webhook_salt")
    .eq("studio_id", studio.id)
    .maybeSingle();
  const nextApiKey = apiKeyInput || existingSecrets?.hitpay_api_key || null;
  const nextWebhookSalt = webhookSaltInput || existingSecrets?.hitpay_webhook_salt || null;
  if (enabled && (!nextApiKey || !nextWebhookSalt)) return;

  const { error } = await supabase
    .from("studios")
    .update({
      hitpay_enabled: enabled,
      hitpay_business_name: businessName,
    })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  const { error: secretErr } = await admin
    .from("studio_payment_secrets")
    .upsert({
      studio_id: studio.id,
      hitpay_api_key: nextApiKey,
      hitpay_webhook_salt: nextWebhookSalt,
      updated_at: new Date().toISOString(),
    });
  if (secretErr) {
    console.error(secretErr.message);
    return;
  }

  revalidatePath("/dashboard/settings/payments");
  revalidatePath("/checkout");
  revalidatePath("/booking");
  if (studio.public_slug) revalidatePath(`/booking/${studio.public_slug}`);
}

function normalizeE164(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\+[1-9][0-9]{6,14}$/.test(v)) return null;
  return v;
}

function sanitizeVideoUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return v;
  } catch {
    return null;
  }
}

function sanitizePrice(raw: FormDataEntryValue | null): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

async function generateUniqueServiceShareSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studioId: string,
): Promise<string | null> {
  for (let i = 0; i < 15; i++) {
    const candidate = generateShareSlugSegment(10);
    const { data: existing } = await supabase
      .from("studio_services")
      .select("id")
      .eq("studio_id", studioId)
      .eq("share_slug", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  return null;
}

export async function updateStudioPublicProfile(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const public_intro = String(formData.get("public_intro") ?? "").trim() || null;
  const public_cover_image_url = String(formData.get("public_cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("public_video_url") ?? "");
  const public_video_url = sanitizeVideoUrl(rawVideo);
  const public_services_title = String(formData.get("public_services_title") ?? "").trim() || null;
  const public_classes_title = String(formData.get("public_classes_title") ?? "").trim() || null;
  const public_packages_title = String(formData.get("public_packages_title") ?? "").trim() || null;
  const whatsapp_enabled = formData.get("whatsapp_enabled") === "on";
  const rawWhatsapp = String(formData.get("whatsapp_number_e164") ?? "");
  const whatsapp_number_e164 = normalizeE164(rawWhatsapp);
  const whatsapp_prefill_text = String(formData.get("whatsapp_prefill_text") ?? "").trim() || null;

  if (rawVideo.trim() && !public_video_url) return;
  if (rawWhatsapp.trim() && !whatsapp_number_e164) return;

  const { error } = await supabase
    .from("studios")
    .update({
      public_intro,
      public_cover_image_url,
      public_video_url,
      public_services_title,
      public_classes_title,
      public_packages_title,
      whatsapp_enabled,
      whatsapp_number_e164,
      whatsapp_prefill_text,
    })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/dashboard/settings/public-profile");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
}

export async function createStudioService(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = sanitizePrice(formData.get("price"));
  const currency = String(formData.get("currency") ?? "SGD").trim().toUpperCase() || "SGD";
  if (!/^[A-Z]{3}$/.test(currency)) return;
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("video_url") ?? "");
  const video_url = sanitizeVideoUrl(rawVideo);
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  if (rawVideo.trim() && !video_url) return;
  const share_slug = await generateUniqueServiceShareSlug(supabase, studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("studio_services").insert({
    studio_id: studio.id,
    title,
    summary,
    description,
    price,
    currency,
    cover_image_url,
    video_url,
    tags,
    share_slug,
    is_active: true,
    sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
  });
  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/dashboard/services");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
}

export async function updateStudioService(formData: FormData): Promise<void> {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!serviceId || !studioId) return;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = sanitizePrice(formData.get("price"));
  const currency = String(formData.get("currency") ?? "SGD").trim().toUpperCase() || "SGD";
  if (!/^[A-Z]{3}$/.test(currency)) return;
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("video_url") ?? "");
  const video_url = sanitizeVideoUrl(rawVideo);
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";
  if (rawVideo.trim() && !video_url) return;

  const { error } = await supabase
    .from("studio_services")
    .update({
      title,
      summary,
      description,
      price,
      currency,
      cover_image_url,
      video_url,
      tags,
      is_active,
      sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
    })
    .eq("id", serviceId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/dashboard/services");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
}

export async function deleteStudioService(formData: FormData): Promise<void> {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!serviceId || !studioId) return;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const { error } = await supabase
    .from("studio_services")
    .delete()
    .eq("id", serviceId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/dashboard/services");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
}

export async function updateStudioContractSettings(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { user } = await requireUser();
  if (!isSuperAdminEmail(user.email)) {
    redirect("/dashboard/settings?owner_error=forbidden");
  }
  if (!studioId) return;

  const statusRaw = String(formData.get("contract_status") ?? "").trim().toLowerCase();
  const contract_status = statusRaw === "suspended" ? "suspended" : "active";
  const endsRaw = String(formData.get("contract_ends_at") ?? "").trim();
  let contract_ends_at: string | null = null;
  if (endsRaw) {
    const d = new Date(endsRaw);
    if (Number.isNaN(d.getTime())) return;
    contract_ends_at = d.toISOString();
  }

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return;

  const { error } = await admin
    .from("studios")
    .update({ contract_status, contract_ends_at })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/overview");
  revalidatePath("/dashboard/operations");
}

export async function createLocation(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !name) {
    redirect("/dashboard/settings/locations?loc_error=missing_required_fields");
  }
  if (isStudioContractSuspended(studio)) {
    redirect("/dashboard/settings/locations?loc_error=studio_suspended");
  }
  if (!hasStudioRole(ctx, studio.id, ["owner"])) {
    redirect("/dashboard/settings/locations?loc_error=forbidden");
  }

  const { error } = await supabase.from("locations").insert({
    studio_id: studio.id,
    name,
    address,
    phone,
    is_active: true,
  });
  if (error) {
    redirect("/dashboard/settings/locations?loc_error=create_failed");
  }
  revalidatePath("/dashboard/settings/locations");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/schedule");
  revalidatePath("/dashboard/frontdesk");
  revalidatePath("/dashboard/operations");
  redirect("/dashboard/settings/locations?loc_success=created");
}

export async function updateLocation(formData: FormData): Promise<void> {
  const locationId = String(formData.get("location_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const { supabase, user } = await requireUser();
  if (!locationId || !name) {
    redirect("/dashboard/settings/locations?loc_error=missing_required_fields");
  }
  const { data: location } = await supabase
    .from("locations")
    .select("id, studio_id")
    .eq("id", locationId)
    .maybeSingle();
  if (!location) {
    redirect("/dashboard/settings/locations?loc_error=not_found");
  }
  const { data: studio } = await supabase
    .from("studios")
    .select("id, owner_id, contract_status")
    .eq("id", location.studio_id)
    .maybeSingle();
  if (!studio || studio.owner_id !== user.id) {
    redirect("/dashboard/settings/locations?loc_error=forbidden");
  }
  if (isStudioContractSuspended(studio)) {
    redirect("/dashboard/settings/locations?loc_error=studio_suspended");
  }

  const { error } = await supabase
    .from("locations")
    .update({ name, address, phone })
    .eq("id", location.id);
  if (error) {
    redirect("/dashboard/settings/locations?loc_error=save_failed");
  }
  revalidatePath("/dashboard/settings/locations");
  revalidatePath("/dashboard/schedule");
  revalidatePath("/dashboard/frontdesk");
  revalidatePath("/dashboard/operations");
  redirect("/dashboard/settings/locations?loc_success=updated");
}

export async function toggleLocationActive(formData: FormData): Promise<void> {
  const locationId = String(formData.get("location_id") ?? "").trim();
  const nextActive = formData.get("next_active") === "true";
  const { supabase, user } = await requireUser();
  if (!locationId) return;

  const { data: location } = await supabase
    .from("locations")
    .select("id, studio_id")
    .eq("id", locationId)
    .maybeSingle();
  if (!location) {
    redirect("/dashboard/settings/locations?loc_error=not_found");
  }
  const { data: studio } = await supabase
    .from("studios")
    .select("id, owner_id, contract_status")
    .eq("id", location.studio_id)
    .maybeSingle();
  if (!studio || studio.owner_id !== user.id) {
    redirect("/dashboard/settings/locations?loc_error=forbidden");
  }
  if (isStudioContractSuspended(studio)) {
    redirect("/dashboard/settings/locations?loc_error=studio_suspended");
  }

  await supabase
    .from("locations")
    .update({ is_active: nextActive })
    .eq("id", location.id);

  revalidatePath("/dashboard/settings/locations");
  revalidatePath("/dashboard/schedule");
  revalidatePath("/dashboard/frontdesk");
  revalidatePath("/dashboard/operations");
  redirect("/dashboard/settings/locations?loc_success=status_updated");
}

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

  // Only allow editing members that belong to this studio scope.
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

  revalidatePath("/dashboard/clients");
  revalidatePath(`/dashboard/clients/${clientId}`);
  redirect(`/dashboard/clients/${clientId}?studio_id=${studio.id}${locationId ? `&location_id=${locationId}` : ""}&member_saved=1`);
}

export async function createInstructor(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const { error } = await supabase.from("instructors").insert({
    studio_id: studio.id,
    location_id: locationId,
    name,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/classes");
}

export async function createClassTemplate(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId || null))) return;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const capacity = Number(formData.get("capacity") ?? 10);
  const duration_min = Number(formData.get("duration_min") ?? 60);
  const instructor_id = String(formData.get("instructor_id") ?? "").trim();
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const video_url = sanitizeVideoUrl(String(formData.get("video_url") ?? "")) || null;

  if (!title) return;
  if (instructor_id) {
    const { data: ins } = await supabase
      .from("instructors")
      .select("id, studio_id, location_id")
      .eq("id", instructor_id)
      .maybeSingle();
    if (!ins || ins.studio_id !== studio.id) return;
    if (locationId && ins.location_id && ins.location_id !== locationId) return;
  }

  const { error } = await supabase.from("classes").insert({
    studio_id: studio.id,
    location_id: locationId || null,
    title,
    description: description || null,
    capacity: Number.isFinite(capacity) ? capacity : 10,
    duration_min: Number.isFinite(duration_min) ? duration_min : 60,
    instructor_id: instructor_id ? instructor_id : null,
    tags,
    image_url,
    video_url,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/classes");
  revalidatePath("/dashboard/schedule");
}

export async function createSession(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager", "frontdesk"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId || null))) return;

  const class_id = String(formData.get("class_id") ?? "");
  const start = String(formData.get("start_time") ?? "");
  const guest_price = Number(formData.get("guest_price") ?? 0);
  const credits_required = Number(formData.get("credits_required") ?? 1);
  if (!class_id || !start) return;
  if (!Number.isFinite(guest_price) || guest_price < 0) return;
  if (!Number.isFinite(credits_required) || credits_required <= 0) return;

  const { data: cls, error: cErr } = await supabase
    .from("classes")
    .select("id, title, description, image_url, video_url, duration_min, capacity, studio_id, location_id, is_active")
    .eq("id", class_id)
    .single();

  if (cErr || !cls || cls.studio_id !== studio.id) {
    return;
  }
  if (cls.is_active === false) return;
  if (locationId && cls.location_id && cls.location_id !== locationId) return;

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return;
  const endDate = new Date(startDate.getTime() + cls.duration_min * 60000);

  const { error } = await supabase.from("class_sessions").insert({
    class_id: cls.id,
    location_id: locationId || cls.location_id || null,
    class_title_snapshot: cls.title,
    class_description_snapshot: cls.description ?? null,
    class_image_url_snapshot: (cls as { image_url?: string | null }).image_url ?? null,
    class_video_url_snapshot: (cls as { video_url?: string | null }).video_url ?? null,
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    capacity: cls.capacity,
    guest_price,
    credits_required: Math.floor(credits_required),
    status: "scheduled",
    spots_left: cls.capacity,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/schedule");
  revalidatePath("/booking");
  if (studio.public_slug) {
    revalidatePath(`/booking/${studio.public_slug}`);
  }
}

export async function createPackage(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId || null))) return;

  const name = String(formData.get("name") ?? "").trim();
  const credits = Number(formData.get("credits") ?? 0);
  const price = Number(formData.get("price") ?? 0);
  const expiry_days_raw = formData.get("expiry_days");
  const expiry_days =
    expiry_days_raw === "" || expiry_days_raw === null
      ? null
      : Number(expiry_days_raw);
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const video_url = sanitizeVideoUrl(String(formData.get("video_url") ?? "")) || null;

  if (!name) return;
  if (!Number.isFinite(credits) || credits <= 0) return;
  if (!Number.isFinite(price) || price < 0) return;

  const { error } = await supabase.from("packages").insert({
    studio_id: studio.id,
    location_id: locationId || null,
    name,
    credits,
    price,
    expiry_days: expiry_days != null && Number.isFinite(expiry_days) ? expiry_days : null,
    type: "class_pack",
    image_url,
    video_url,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/packages");
  revalidatePath("/checkout");
}

async function generateUniqueMembershipShareSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studioId: string,
): Promise<string | null> {
  for (let i = 0; i < 15; i += 1) {
    const candidate = generateShareSlugSegment(10);
    const { data: existing } = await supabase
      .from("membership_products")
      .select("id")
      .eq("studio_id", studioId)
      .eq("share_slug", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  return null;
}

export async function createMembershipProduct(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId || null))) return;

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const billingIntervalRaw = String(formData.get("billing_interval") ?? "").trim().toLowerCase();
  const billing_interval = billingIntervalRaw === "yearly" ? "yearly" : "monthly";
  const price = Number(formData.get("price") ?? 0);
  const trialEnabled = formData.get("trial_enabled") === "on";
  const trialDaysRaw = Number(formData.get("trial_days") ?? 0);
  const trial_days = trialEnabled && Number.isFinite(trialDaysRaw) ? Math.max(1, Math.min(60, Math.floor(trialDaysRaw))) : 0;
  if (!name || !Number.isFinite(price) || price < 0) return;

  const share_slug = await generateUniqueMembershipShareSlug(supabase, studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("membership_products").insert({
    studio_id: studio.id,
    location_id: locationId || null,
    name,
    description,
    price,
    currency: "SGD",
    billing_interval,
    is_active: true,
    share_slug,
    trial_days,
  });
  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/dashboard/memberships");
  if (studio.public_slug) {
    revalidatePath(`/${studio.public_slug}`);
    revalidatePath(`/membership/${studio.public_slug}/${share_slug}`);
  }
}

async function generateUniqueEventShareSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studioId: string,
): Promise<string | null> {
  for (let i = 0; i < 15; i += 1) {
    const candidate = generateShareSlugSegment(10);
    const { data: existing } = await supabase
      .from("events")
      .select("id")
      .eq("studio_id", studioId)
      .eq("share_slug", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  return null;
}

export async function createEvent(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const address_details = String(formData.get("address_details") ?? "").trim() || null;
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const startRaw = String(formData.get("start_time") ?? "");
  const endRaw = String(formData.get("end_time") ?? "");
  const capacity = Number(formData.get("capacity") ?? 0);
  const price = sanitizePrice(formData.get("price"));
  const currency = "SGD";
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const video_url = sanitizeVideoUrl(String(formData.get("video_url") ?? "")) || null;

  if (!title) return;
  if (!Number.isFinite(capacity) || capacity <= 0) return;
  if (!(price > 0)) return;

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (!(end.getTime() > start.getTime())) return;

  const share_slug = await generateUniqueEventShareSlug(supabase, studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("events").insert({
    studio_id: studio.id,
    title,
    description,
    tags,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    capacity: Math.floor(capacity),
    spots_left: Math.floor(capacity),
    price,
    currency,
    is_active: true,
    share_slug,
    image_url,
    video_url,
    address,
    address_details,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/events");
  revalidatePath("/checkout");
}

export async function updateEvent(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const eventId = String(formData.get("event_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !eventId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const address_details = String(formData.get("address_details") ?? "").trim() || null;
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const is_active = formData.get("is_active") ? true : false;
  const startRaw = String(formData.get("start_time") ?? "");
  const endRaw = String(formData.get("end_time") ?? "");
  const capacity = Number(formData.get("capacity") ?? 0);
  const price = sanitizePrice(formData.get("price"));
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const video_url = sanitizeVideoUrl(String(formData.get("video_url") ?? "")) || null;

  if (!title) return;
  if (!Number.isFinite(capacity) || capacity <= 0) return;
  if (!(price > 0)) return;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (!(end.getTime() > start.getTime())) return;

  const { data: existing } = await supabase
    .from("events")
    .select("id, studio_id, capacity, spots_left")
    .eq("id", eventId)
    .maybeSingle();
  if (!existing || existing.studio_id !== studio.id) return;

  const prevCapacity = Number(existing.capacity ?? 0);
  const prevSpots = Number(existing.spots_left ?? 0);
  const booked = Math.max(prevCapacity - prevSpots, 0);
  const nextCapacity = Math.floor(capacity);
  if (nextCapacity < booked) return;
  const nextSpots = Math.max(0, nextCapacity - booked);

  const { error } = await supabase
    .from("events")
    .update({
      title,
      description,
      tags,
      is_active,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      capacity: nextCapacity,
      spots_left: nextSpots,
      price,
      image_url,
      video_url,
      address,
      address_details,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/events");
  revalidatePath("/checkout");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const eventId = String(formData.get("event_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !eventId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  // Soft-delete isn't implemented for events yet; disable instead.
  const { error } = await supabase.from("events").update({ is_active: false }).eq("id", eventId).eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/events");
}

async function generateUniqueMemberZoneSeriesShareSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studioId: string,
): Promise<string | null> {
  for (let i = 0; i < 15; i += 1) {
    const candidate = generateShareSlugSegment(10);
    const { data: existing } = await supabase
      .from("member_zone_series")
      .select("id")
      .eq("studio_id", studioId)
      .eq("share_slug", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  return null;
}

export async function createMemberZoneSeries(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const promo_video_url = sanitizeVideoUrl(String(formData.get("promo_video_url") ?? "")) || null;
  const accessTypeRaw = String(formData.get("access_type") ?? "member_only").trim().toLowerCase();
  const access_type =
    accessTypeRaw === "free" || accessTypeRaw === "paid_only" || accessTypeRaw === "member_only" || accessTypeRaw === "member_or_paid"
      ? accessTypeRaw
      : "member_only";
  const price = sanitizePrice(formData.get("price"));
  const currency = String(formData.get("currency") ?? "SGD").trim().toUpperCase() || "SGD";
  if (!/^[A-Z]{3}$/.test(currency)) return;
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const share_slug = await generateUniqueMemberZoneSeriesShareSlug(supabase, studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("member_zone_series").insert({
    studio_id: studio.id,
    title,
    summary,
    description,
    cover_image_url,
    promo_video_url,
    access_type,
    price: access_type === "paid_only" || access_type === "member_or_paid" ? price : 0,
    currency,
    sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
    share_slug,
    is_active: true,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/member-zone");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
}

export async function updateMemberZoneSeries(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const promo_video_url = sanitizeVideoUrl(String(formData.get("promo_video_url") ?? "")) || null;
  const accessTypeRaw = String(formData.get("access_type") ?? "member_only").trim().toLowerCase();
  const access_type =
    accessTypeRaw === "free" || accessTypeRaw === "paid_only" || accessTypeRaw === "member_only" || accessTypeRaw === "member_or_paid"
      ? accessTypeRaw
      : "member_only";
  const price = sanitizePrice(formData.get("price"));
  const currency = String(formData.get("currency") ?? "SGD").trim().toUpperCase() || "SGD";
  if (!/^[A-Z]{3}$/.test(currency)) return;
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";

  const { error } = await supabase
    .from("member_zone_series")
    .update({
      title,
      summary,
      description,
      cover_image_url,
      promo_video_url,
      access_type,
      price: access_type === "paid_only" || access_type === "member_or_paid" ? price : 0,
      currency,
      sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
      is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", seriesId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/member-zone");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
}

export async function deleteMemberZoneSeries(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const { error } = await supabase
    .from("member_zone_series")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", seriesId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/member-zone");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
}

export async function createMemberZoneLesson(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: series } = await supabase
    .from("member_zone_series")
    .select("id")
    .eq("id", seriesId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!series) return;

  const title = String(formData.get("title") ?? "").trim();
  const media_url = String(formData.get("media_url") ?? "").trim();
  if (!title || !media_url) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const mediaTypeRaw = String(formData.get("media_type") ?? "video").trim().toLowerCase();
  const media_type = mediaTypeRaw === "audio" ? "audio" : "video";
  const durationMin = Number(formData.get("duration_min") ?? 0);
  const accessOverrideRaw = String(formData.get("access_override") ?? "inherit").trim().toLowerCase();
  const access_override =
    accessOverrideRaw === "inherit" || accessOverrideRaw === "free" || accessOverrideRaw === "paid_only" || accessOverrideRaw === "member_only" || accessOverrideRaw === "member_or_paid"
      ? accessOverrideRaw
      : "inherit";
  const override_price = sanitizePrice(formData.get("override_price"));
  const currency = String(formData.get("currency") ?? "SGD").trim().toUpperCase() || "SGD";
  if (!/^[A-Z]{3}$/.test(currency)) return;
  const sort_order = Number(formData.get("sort_order") ?? 100);

  const { error } = await supabase.from("member_zone_lessons").insert({
    series_id: series.id,
    title,
    summary,
    description,
    media_url,
    media_type,
    duration_min: Number.isFinite(durationMin) ? Math.max(0, Math.floor(durationMin)) : 0,
    access_override,
    override_price: access_override === "paid_only" || access_override === "member_or_paid" ? override_price : 0,
    currency,
    sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
    is_active: true,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/member-zone");
}

export async function updateMemberZoneLesson(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const lessonId = String(formData.get("lesson_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId || !lessonId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: series } = await supabase
    .from("member_zone_series")
    .select("id")
    .eq("id", seriesId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!series) return;

  const title = String(formData.get("title") ?? "").trim();
  const media_url = String(formData.get("media_url") ?? "").trim();
  if (!title || !media_url) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const mediaTypeRaw = String(formData.get("media_type") ?? "video").trim().toLowerCase();
  const media_type = mediaTypeRaw === "audio" ? "audio" : "video";
  const durationMin = Number(formData.get("duration_min") ?? 0);
  const accessOverrideRaw = String(formData.get("access_override") ?? "inherit").trim().toLowerCase();
  const access_override =
    accessOverrideRaw === "inherit" || accessOverrideRaw === "free" || accessOverrideRaw === "paid_only" || accessOverrideRaw === "member_only" || accessOverrideRaw === "member_or_paid"
      ? accessOverrideRaw
      : "inherit";
  const override_price = sanitizePrice(formData.get("override_price"));
  const currency = String(formData.get("currency") ?? "SGD").trim().toUpperCase() || "SGD";
  if (!/^[A-Z]{3}$/.test(currency)) return;
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";

  const { error } = await supabase
    .from("member_zone_lessons")
    .update({
      title,
      summary,
      description,
      media_url,
      media_type,
      duration_min: Number.isFinite(durationMin) ? Math.max(0, Math.floor(durationMin)) : 0,
      access_override,
      override_price: access_override === "paid_only" || access_override === "member_or_paid" ? override_price : 0,
      currency,
      sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
      is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lessonId)
    .eq("series_id", series.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/member-zone");
}

export async function deleteMemberZoneLesson(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const lessonId = String(formData.get("lesson_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId || !lessonId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: series } = await supabase
    .from("member_zone_series")
    .select("id")
    .eq("id", seriesId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!series) return;

  const { error } = await supabase
    .from("member_zone_lessons")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", lessonId)
    .eq("series_id", series.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/member-zone");
}

export async function markAttended(bookingId: string): Promise<void> {
  const { supabase, studio, user, ctx } = await requireStudio();
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager", "frontdesk", "instructor"])) return;

  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select(
      `
      id,
      class_sessions (
        classes ( studio_id )
      )
    `,
    )
    .eq("id", bookingId)
    .single();

  if (bErr || !booking) return;
  const sid = (booking.class_sessions as { classes?: { studio_id?: string } } | null)?.classes
    ?.studio_id;
  if (sid !== studio.id) return;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("checkin_booking", {
    p_booking_id: bookingId,
    p_actor_id: user.id,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  const result = data as { ok?: boolean; error?: string };
  if (!result?.ok) {
    console.error(result?.error ?? "checkin_failed");
    return;
  }
  revalidatePath("/dashboard/schedule");
}

export async function createRecurringRule(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const classId = String(formData.get("class_id") ?? "");
  const byWeekday = String(formData.get("by_weekday") ?? "");
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "");
  const startTime = String(formData.get("start_time") ?? "");
  const duration = Number(formData.get("duration_min") ?? 60);
  const capacity = Number(formData.get("capacity") ?? 10);
  const guestPrice = Number(formData.get("guest_price") ?? 0);
  const creditsRequired = Number(formData.get("credits_required") ?? 1);

  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !locationId || !classId || !startDate || !startTime) return;
  if (!Number.isFinite(guestPrice) || guestPrice < 0) return;
  if (!Number.isFinite(creditsRequired) || creditsRequired <= 0) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) return;
  const { data: cls } = await supabase
    .from("classes")
    .select("id, title, description, image_url, studio_id, location_id, is_active")
    .eq("id", classId)
    .maybeSingle();
  if (!cls || cls.studio_id !== studio.id) return;
  if (cls.is_active === false) return;
  if (cls.location_id && cls.location_id !== locationId) return;

  const { data: rule, error } = await supabase
    .from("recurring_rules")
    .insert({
      class_id: classId,
      location_id: locationId,
      frequency: "weekly",
      interval_value: 1,
      by_weekday: byWeekday,
      start_date: startDate,
      end_date: endDate || null,
      start_time: startTime,
      duration_min: Number.isFinite(duration) ? duration : 60,
      capacity: Number.isFinite(capacity) ? capacity : 10,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !rule) return;

  const weekdays = byWeekday
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const targetDays = weekdays.length ? weekdays.map((w) => map[w]).filter((d) => d != null) : [];
  const horizonEnd = new Date(startDate);
  horizonEnd.setDate(horizonEnd.getDate() + 56);
  const hardEnd = endDate ? new Date(endDate) : horizonEnd;
  const end = hardEnd < horizonEnd ? hardEnd : horizonEnd;

  const d = new Date(startDate);
  while (d <= end) {
    const dow = d.getDay();
    if (targetDays.length === 0 || targetDays.includes(dow)) {
      const [h, m] = startTime.split(":").map(Number);
      const st = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0));
      const en = new Date(st.getTime() + duration * 60000);
      const exists = await supabase
        .from("class_sessions")
        .select("id")
        .eq("class_id", classId)
        .eq("location_id", locationId)
        .eq("start_time", st.toISOString())
        .maybeSingle();
      if (!exists.data) {
        await supabase.from("class_sessions").insert({
          class_id: classId,
          location_id: locationId,
          class_title_snapshot: (cls as { title?: string | null }).title ?? null,
          class_description_snapshot: (cls as { description?: string | null }).description ?? null,
          class_image_url_snapshot: (cls as { image_url?: string | null }).image_url ?? null,
          start_time: st.toISOString(),
          end_time: en.toISOString(),
          capacity,
        guest_price: guestPrice,
        credits_required: Math.floor(creditsRequired),
          spots_left: capacity,
          status: "scheduled",
          recurring_rule_id: rule.id,
        });
      }
    }
    d.setDate(d.getDate() + 1);
  }

  revalidatePath("/dashboard/schedule");
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

  const { data: me } = await supabase
    .from("studios")
    .select("id")
    .eq("id", studio.id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!me) {
    redirect("/dashboard/staff?staff_error=forbidden");
  }
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

  revalidatePath("/dashboard/staff");
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

  const { data: studio } = await supabase
    .from("studios")
    .select("id, contract_status")
    .eq("id", membership.studio_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (membership.role === "owner") return;

  await supabase
    .from("staff_memberships")
    .update({ is_active: nextActive })
    .eq("id", membership.id);

  revalidatePath("/dashboard/staff");
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
  const { data: me } = await supabase
    .from("studios")
    .select("id")
    .eq("id", studio.id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!me) {
    redirect("/dashboard/settings/staff-invites?invite_error=forbidden");
  }
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
  revalidatePath("/dashboard/settings/staff-invites");
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
  const { data: me } = await supabase
    .from("studios")
    .select("id")
    .eq("id", invite.studio_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!me) return;

  await supabase.from("staff_invites").update({ status: "revoked" }).eq("id", invite.id);
  revalidatePath("/dashboard/settings/staff-invites");
}

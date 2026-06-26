"use server";

import { revalidatePath } from "next/cache";
import {
  revalidateDashboardCoreViews,
  revalidateDashboardCustomDomainViews,
  revalidateDashboardSettings,
  revalidatePublicStudioPath,
  revalidateRbacCache,
} from "@/lib/revalidatePublic";
import { redirect } from "next/navigation";
import { resolveAccessContext } from "@/lib/rbac";
import { normalizeStudioSlug } from "@/lib/slug";
import { isReservedCustomDomain, normalizeCustomDomainInput, toCustomDomainUiStatus, type CustomDomainUiStatus } from "@/lib/customDomain";
import {
  getNotConfiguredSnapshot,
  persistCustomDomainSnapshot,
  registerDomainWithVercel,
  removeDomainFromVercel,
  verifyCustomDomain,
} from "@/lib/customDomain.server";
import { isStudioContractSuspended } from "@/lib/studio-contract";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { parseDatetimeLocalAsSgt } from "@/lib/date";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  hasStudioGlobalRole,
  hasStudioRole,
  normalizeE164,
  DashboardFormResult,
  err,
  ok,
  requireOwnedStudioAccess,
  requireStudio,
  requireUser,
  sanitizePublicEmail,
  sanitizePublicExternalUrl,
  sanitizeTrustedLogoUrl,
  sanitizeVideoUrl,
} from "./shared";

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

  if (createdStudio.id) {
    const { error: locationError } = await supabase.from("locations").insert({
      studio_id: createdStudio.id,
      name: "Main",
      is_active: true,
    });
    if (locationError) {
      console.error(`createStudio default location: ${locationError.message}`);
    }
  }

  revalidateDashboardCoreViews();
  revalidatePublicStudioPath(public_slug);
  revalidateRbacCache();
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

  revalidateDashboardCoreViews();
  revalidateDashboardSettings("public-profile");
  revalidatePublicStudioPath(public_slug);
  revalidatePublicStudioPath(studio.public_slug);
}

export type CustomDomainFormResult = {
  ok: boolean;
  message: string;
  status: CustomDomainUiStatus;
};

export type HitpaySettingsResult = {
  ok: boolean;
  message: string;
  enabled: boolean;
  hasBusinessName: boolean;
  hasApiKey: boolean;
  hasWebhookSalt: boolean;
};

export async function updateStudioCustomDomain(
  _prevState: CustomDomainFormResult | null,
  formData: FormData,
): Promise<CustomDomainFormResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) {
    return {
      ok: false,
      message: "Studio not found.",
      status: toCustomDomainUiStatus(getNotConfiguredSnapshot()),
    };
  }
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) {
    return {
      ok: false,
      message: "You do not have permission to manage this domain.",
      status: toCustomDomainUiStatus(getNotConfiguredSnapshot()),
    };
  }

  const raw = String(formData.get("custom_domain") ?? "").trim();
  const domain = normalizeCustomDomainInput(raw);

  if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return {
      ok: false,
      message: "Enter a valid domain such as book.yourstudio.com.",
      status: toCustomDomainUiStatus(getNotConfiguredSnapshot()),
    };
  }

  if (isReservedCustomDomain(domain)) {
    return {
      ok: false,
      message: "Use a dedicated customer-facing domain, not the platform hostname.",
      status: toCustomDomainUiStatus(getNotConfiguredSnapshot()),
    };
  }

  const { data: current } = await supabase
    .from("studios")
    .select("custom_domain")
    .eq("id", studio.id)
    .single();
  const oldDomain = current?.custom_domain ?? null;

  if (!domain) {
    try {
      await persistCustomDomainSnapshot(studio.id, getNotConfiguredSnapshot());
      if (oldDomain) await removeDomainFromVercel(oldDomain);
    } catch (error) {
      console.error("[updateStudioCustomDomain remove]", error);
      return {
        ok: false,
        message: "Could not remove the custom domain.",
        status: toCustomDomainUiStatus(getNotConfiguredSnapshot()),
      };
    }

    revalidateDashboardSettings("public-profile");
    revalidateDashboardCustomDomainViews();
    return {
      ok: true,
      message: "Custom domain removed.",
      status: toCustomDomainUiStatus(getNotConfiguredSnapshot()),
    };
  }

  try {
    const registration = await registerDomainWithVercel(domain);
    const snapshot = await verifyCustomDomain({
      domain,
      vercelStatus: registration.vercelStatus,
      lastError: registration.lastError,
    });
    await persistCustomDomainSnapshot(studio.id, snapshot);
    if (oldDomain && oldDomain !== domain) await removeDomainFromVercel(oldDomain);

    revalidateDashboardSettings("public-profile");
    revalidateDashboardCustomDomainViews();

    const uiStatus = toCustomDomainUiStatus(snapshot);
    return {
      ok: true,
      message:
        snapshot.overallStatus === "active"
          ? `Custom domain is active on ${domain}.`
          : `Domain saved for ${domain}. Complete DNS and verify again if needed.`,
      status: uiStatus,
    };
  } catch (error) {
    console.error("[updateStudioCustomDomain]", error);
    return {
      ok: false,
      message: "Could not save the custom domain.",
      status: toCustomDomainUiStatus(getNotConfiguredSnapshot()),
    };
  }
}

export async function updateStudioHitpaySettings(
  _prevState: HitpaySettingsResult | null,
  formData: FormData,
): Promise<HitpaySettingsResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) {
    return {
      ok: false,
      message: "Studio not found.",
      enabled: false,
      hasBusinessName: false,
      hasApiKey: false,
      hasWebhookSalt: false,
    };
  }
  if (!hasStudioRole(ctx, studio.id, ["owner"])) {
    return {
      ok: false,
      message: "Only owners can update payment settings.",
      enabled: false,
      hasBusinessName: false,
      hasApiKey: false,
      hasWebhookSalt: false,
    };
  }

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
  const hasBusinessName = Boolean(businessName);
  const hasApiKey = Boolean(nextApiKey);
  const hasWebhookSalt = Boolean(nextWebhookSalt);

  if (enabled && !process.env.HITPAY_PLATFORM_API_KEY?.trim()) {
    return {
      ok: false,
      message: "Platform HitPay key is missing on the server. Add HITPAY_PLATFORM_API_KEY before enabling this studio.",
      enabled: false,
      hasBusinessName,
      hasApiKey,
      hasWebhookSalt,
    };
  }
  if (enabled && !hasBusinessName) {
    return {
      ok: false,
      message: "Business name is required before enabling HitPay for this studio.",
      enabled: false,
      hasBusinessName,
      hasApiKey,
      hasWebhookSalt,
    };
  }
  if (enabled && (!hasApiKey || !hasWebhookSalt)) {
    return {
      ok: false,
      message: "Merchant API key and webhook salt are both required before enabling HitPay.",
      enabled: false,
      hasBusinessName,
      hasApiKey,
      hasWebhookSalt,
    };
  }

  const { error } = await supabase
    .from("studios")
    .update({
      hitpay_enabled: enabled,
      hitpay_business_name: businessName,
    })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return {
      ok: false,
      message: "Could not save HitPay settings.",
      enabled,
      hasBusinessName,
      hasApiKey,
      hasWebhookSalt,
    };
  }
  const { error: secretError } = await admin
    .from("studio_payment_secrets")
    .upsert({
      studio_id: studio.id,
      hitpay_api_key: nextApiKey,
      hitpay_webhook_salt: nextWebhookSalt,
      updated_at: new Date().toISOString(),
    });
  if (secretError) {
    console.error(secretError.message);
    return {
      ok: false,
      message: "Could not save HitPay credentials.",
      enabled,
      hasBusinessName,
      hasApiKey,
      hasWebhookSalt,
    };
  }

  revalidateDashboardSettings("payments");
  revalidatePath("/");
  if (studio.public_slug) revalidatePublicStudioPath(studio.public_slug);
  return {
    ok: true,
    message: enabled
      ? "HitPay settings saved. This studio is ready to accept HitPay payments."
      : "HitPay settings saved.",
    enabled,
    hasBusinessName,
    hasApiKey,
    hasWebhookSalt,
  };
}

export async function updateStudioPublicProfile(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const public_intro = String(formData.get("public_intro") ?? "").trim() || null;
  const public_cover_image_url = String(formData.get("public_cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("public_video_url") ?? "");
  const public_video_url = sanitizeVideoUrl(rawVideo);
  const public_services_title = String(formData.get("public_services_title") ?? "").trim() || null;
  const public_classes_title = String(formData.get("public_classes_title") ?? "").trim() || null;
  const public_packages_title = String(formData.get("public_packages_title") ?? "").trim() || null;
  const public_events_title = String(formData.get("public_events_title") ?? "").trim() || null;
  const public_member_zone_title = String(formData.get("public_member_zone_title") ?? "").trim() || null;
  const public_shop_title = String(formData.get("public_shop_title") ?? "").trim() || null;
  const rawInstagramUrl = String(formData.get("public_instagram_url") ?? "");
  const public_instagram_url = sanitizePublicExternalUrl(rawInstagramUrl);
  const rawLinkedinUrl = String(formData.get("public_linkedin_url") ?? "");
  const public_linkedin_url = sanitizePublicExternalUrl(rawLinkedinUrl);
  const rawFacebookUrl = String(formData.get("public_facebook_url") ?? "");
  const public_facebook_url = sanitizePublicExternalUrl(rawFacebookUrl);
  const rawTiktokUrl = String(formData.get("public_tiktok_url") ?? "");
  const public_tiktok_url = sanitizePublicExternalUrl(rawTiktokUrl);
  const rawYoutubeUrl = String(formData.get("public_youtube_url") ?? "");
  const public_youtube_url = sanitizePublicExternalUrl(rawYoutubeUrl);
  const rawXUrl = String(formData.get("public_x_url") ?? "");
  const public_x_url = sanitizePublicExternalUrl(rawXUrl);
  const rawContactEmail = String(formData.get("public_contact_email") ?? "");
  const public_contact_email = sanitizePublicEmail(rawContactEmail);
  const whatsapp_enabled = formData.get("whatsapp_enabled") === "on";
  const rawWhatsapp = String(formData.get("whatsapp_number_e164") ?? "");
  const whatsapp_number_e164 = normalizeE164(rawWhatsapp);
  const whatsapp_prefill_text = String(formData.get("whatsapp_prefill_text") ?? "").trim() || null;

  if (rawVideo.trim() && !public_video_url) return;
  if (rawInstagramUrl.trim() && !public_instagram_url) return;
  if (rawLinkedinUrl.trim() && !public_linkedin_url) return;
  if (rawFacebookUrl.trim() && !public_facebook_url) return;
  if (rawTiktokUrl.trim() && !public_tiktok_url) return;
  if (rawYoutubeUrl.trim() && !public_youtube_url) return;
  if (rawXUrl.trim() && !public_x_url) return;
  if (rawContactEmail.trim() && !public_contact_email) return;
  if (rawWhatsapp.trim() && !whatsapp_number_e164) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("studios")
    .update({
      public_intro,
      public_cover_image_url,
      public_video_url,
      public_services_title,
      public_classes_title,
      public_packages_title,
      public_events_title,
      public_member_zone_title,
      public_shop_title,
      public_instagram_url,
      public_linkedin_url,
      public_facebook_url,
      public_tiktok_url,
      public_youtube_url,
      public_x_url,
      public_contact_email,
      whatsapp_enabled,
      whatsapp_number_e164,
      whatsapp_prefill_text,
    })
    .eq("id", studio.id);
  if (error) {
    console.error("[updateStudioPublicProfile]", error.message);
    return;
  }

  revalidateDashboardSettings("public-profile");
  if (studio.public_slug) revalidatePublicStudioPath(studio.public_slug);
}

export type BookingSettingsResult = {
  ok: boolean;
  message: string;
  enabled?: boolean;
  url?: string | null;
};

export async function updateStudioBookingSettings(
  _prevState: BookingSettingsResult | null,
  formData: FormData,
): Promise<BookingSettingsResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return { ok: false, message: "Studio not found." };
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) {
    return { ok: false, message: "You do not have permission to update booking settings." };
  }

  const calcom_booking_enabled = formData.get("calcom_booking_enabled") === "on";
  const rawUrl = String(formData.get("calcom_embed_url") ?? "").trim();
  let calcom_embed_url: string | null = null;

  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === "https:" && (url.hostname === "cal.com" || url.hostname === "www.cal.com")) {
        calcom_embed_url = url.toString();
      }
    } catch {
      // handled below
    }
  }

  if (rawUrl && !calcom_embed_url) {
    return {
      ok: false,
      message: "Enter a valid https://cal.com/... or https://www.cal.com/... URL.",
    };
  }
  if (calcom_booking_enabled && !calcom_embed_url) {
    return {
      ok: false,
      message: "Paste your Cal.com URL before enabling booking on the public page.",
    };
  }

  const { error } = await supabase
    .from("studios")
    .update({
      calcom_booking_enabled,
      calcom_embed_url,
    })
    .eq("id", studio.id);
  if (error) {
    console.error("[updateStudioBookingSettings]", error.message);
    return { ok: false, message: "Could not save booking settings." };
  }

  revalidateDashboardSettings("public-profile");
  revalidateDashboardSettings("booking");
  if (studio.public_slug) revalidatePublicStudioPath(studio.public_slug);

  return {
    ok: true,
    enabled: calcom_booking_enabled,
    url: calcom_embed_url,
    message: calcom_booking_enabled
      ? "Booking is enabled on your public page."
      : calcom_embed_url
        ? "Cal.com URL saved, but booking is currently disabled."
        : "Booking integration removed.",
  };
}

export async function savePublicLogoUrl(studioId: string, logoUrl: string | null): Promise<void> {
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const rawUrl = logoUrl ? logoUrl.trim() : null;
  const url = sanitizeTrustedLogoUrl(rawUrl);
  if (rawUrl && !url) return;

  const { error } = await supabase
    .from("studios")
    .update({ public_logo_url: url })
    .eq("id", studio.id);
  if (error) {
    console.error("[savePublicLogoUrl]", error.message);
    return;
  }
  revalidateDashboardSettings("public-profile");
  if (studio.public_slug) revalidatePublicStudioPath(studio.public_slug);
}

export async function updateStudioPublicBranding(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const public_brand_name = String(formData.get("public_brand_name") ?? "").trim() || null;
  const rawLogoUrl = String(formData.get("public_logo_url") ?? "").trim() || null;
  const public_logo_url = sanitizeTrustedLogoUrl(rawLogoUrl);
  if (rawLogoUrl && !public_logo_url) return;

  const { error } = await supabase
    .from("studios")
    .update({
      public_brand_name,
      public_logo_url,
    })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }

  revalidateDashboardSettings("public-profile");
  if (studio.public_slug) revalidatePublicStudioPath(studio.public_slug);
}

export async function updateStudioContractSettings(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { user } = await requireUser();
  if (!isSuperAdminEmail(user.email)) {
    return err("You do not have access to this action.");
  }
  if (!studioId) return err("Missing studio.");

  const statusRaw = String(formData.get("contract_status") ?? "").trim().toLowerCase();
  const contract_status = statusRaw === "suspended" ? "suspended" : "active";
  const endsRaw = String(formData.get("contract_ends_at") ?? "").trim();
  let contract_ends_at: string | null = null;
  if (endsRaw) {
    const parsed = parseDatetimeLocalAsSgt(endsRaw);
    if (!parsed) return err("Invalid contract end date.");
    contract_ends_at = parsed.toISOString();
  }

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return err("Studio not found.");

  const { error } = await admin
    .from("studios")
    .update({ contract_status, contract_ends_at })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return err("Could not save contract settings.");
  }
  revalidateDashboardCoreViews();
  return ok("Contract settings saved.");
}

export async function createLocation(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !name) return err("Please fill the required fields.");
  if (isStudioContractSuspended(studio)) return err("Studio is suspended. Set contract back to active first.");
  if (!hasStudioRole(ctx, studio.id, ["owner"])) return err("Only owners can manage locations.");

  const { error } = await supabase.from("locations").insert({
    studio_id: studio.id,
    name,
    address,
    phone,
    is_active: true,
  });
  if (error) return err("Could not create location.");
  revalidateDashboardSettings("locations");
  return ok("Location created.");
}

export async function updateLocation(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const locationId = String(formData.get("location_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const { supabase, user } = await requireUser();
  if (!locationId || !name) return err("Please fill the required fields.");
  const { data: location } = await supabase
    .from("locations")
    .select("id, studio_id")
    .eq("id", locationId)
    .maybeSingle();
  if (!location) return err("Location was not found.");
  const studio = await requireOwnedStudioAccess(supabase, location.studio_id, user.id, "/dashboard/settings/locations?loc_error=forbidden");
  if (isStudioContractSuspended(studio)) return err("Studio is suspended. Set contract back to active first.");

  const { error } = await supabase
    .from("locations")
    .update({ name, address, phone })
    .eq("id", location.id);
  if (error) return err("Could not save location.");
  revalidateDashboardSettings("locations");
  return ok("Location updated.");
}

export async function toggleLocationActive(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const locationId = String(formData.get("location_id") ?? "").trim();
  const nextActive = formData.get("next_active") === "true";
  const { supabase, user } = await requireUser();
  if (!locationId) return err("Missing location.");

  const { data: location } = await supabase
    .from("locations")
    .select("id, studio_id")
    .eq("id", locationId)
    .maybeSingle();
  if (!location) return err("Location was not found.");
  const studio = await requireOwnedStudioAccess(supabase, location.studio_id, user.id, "/dashboard/settings/locations?loc_error=forbidden");
  if (isStudioContractSuspended(studio)) return err("Studio is suspended. Set contract back to active first.");

  const { error } = await supabase
    .from("locations")
    .update({ is_active: nextActive })
    .eq("id", location.id);
  if (error) return err("Could not update location status.");

  revalidateDashboardSettings("locations");
  return ok(nextActive ? "Location enabled." : "Location disabled.");
}

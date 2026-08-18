"use server";

import { revalidatePath } from "next/cache";
import {
  revalidateDashboardCoreViews,
  revalidateDashboardCustomDomainViews,
  revalidateDashboardSettings,
  revalidatePublicStudioPath,
  revalidateRbacCache,
} from "@/lib/revalidatePublic";
import { isReservedPublicSlug } from "@/lib/publicStudio";
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
import { setLocationOperatingHoursForWeek } from "@/lib/staff-availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishPrivacyNotice, updateStudioRetentionSettings, markAppointmentRetentionReviewed } from "@/lib/studio-privacy";
import {
  hasStudioGlobalRole,
  hasStudioRole,
  normalizeE164,
  DashboardFormResult,
  err,
  ok,
  parseTimeRangeList,
  requireOwnedStudioAccess,
  requireStudio,
  requireUser,
  sanitizePublicEmail,
  sanitizePublicExternalUrl,
  sanitizeTrustedLogoUrl,
  sanitizeVideoUrl,
} from "./shared";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function parseStudioLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

export async function createStudio(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const { user } = await requireUser();
  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  if (access.bestRole !== "owner" && !access.ctx.isSuperAdmin) {
    console.error("createStudio: only studio owners can create a venue");
    return err("Only studio owners can create a venue.");
  }

  const admin = createAdminClient();
  if (!access.ctx.isSuperAdmin) {
    const { data: grant } = await admin
      .from("platform_owner_grants")
      .select("is_active, studio_limit")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!grant?.is_active) {
      return err("Your platform owner access is not active. Ask a platform admin to enable it before creating a new studio.");
    }
    const studioLimit = parseStudioLimit(grant.studio_limit) ?? 1;
    const { count: studioCount } = await admin
      .from("studios")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);
    if ((studioCount ?? 0) >= studioLimit) {
      return err(`Studio limit reached (${studioLimit}). Ask a platform admin to increase your owner limit before creating another studio.`);
    }
  }

  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("public_slug") ?? "");
  const public_slug = normalizeStudioSlug(slugRaw);
  if (!name || !public_slug) return err("Please enter a studio name and valid public URL slug.");
  if (isReservedPublicSlug(public_slug)) {
    return err("This public URL slug is reserved. Please choose a different slug.");
  }

  const { data: createdStudio, error } = await admin
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
    return err("Could not create studio.");
  }

  if (createdStudio.id) {
    const { error: locationError } = await admin.from("locations").insert({
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
  return ok("Studio created.");
}

export async function updateStudioBasics(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  if (!hasStudioRole(ctx, studio.id, ["owner"])) return err("You do not have permission to update this studio.");

  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("public_slug") ?? "");
  const public_slug = normalizeStudioSlug(slugRaw);
  if (!name || !public_slug) return err("Please enter a studio name and valid public URL slug.");
  if (isReservedPublicSlug(public_slug)) return err("This public URL slug is reserved. Please choose a different slug.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("studios")
    .update({ name, public_slug })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return err("Could not update the studio basics.");
  }

  revalidateDashboardCoreViews();
  revalidateDashboardSettings("public-profile");
  revalidatePublicStudioPath(public_slug);
  revalidatePublicStudioPath(studio.public_slug);
  return ok("Studio basics updated.");
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

export type EmailSettingsResult = {
  ok: boolean;
  message: string;
  enabled: boolean;
  hasFromEmail: boolean;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
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
  const { studio, ctx } = await requireStudio(studioId || undefined);
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

  const { error } = await admin
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

export async function updateStudioEmailSettings(
  _prevState: EmailSettingsResult | null,
  formData: FormData,
): Promise<EmailSettingsResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) {
    return {
      ok: false,
      message: "Studio not found.",
      enabled: false,
      hasFromEmail: false,
      hasApiKey: false,
      hasWebhookSecret: false,
    };
  }
  if (!hasStudioRole(ctx, studio.id, ["owner"])) {
    return {
      ok: false,
      message: "Only owners can update email settings.",
      enabled: false,
      hasFromEmail: false,
      hasApiKey: false,
      hasWebhookSecret: false,
    };
  }

  const enabled = formData.get("resend_enabled") === "on";
  const fromEmailInput = String(formData.get("resend_from_email") ?? "").trim();
  const apiKeyInput = String(formData.get("resend_api_key") ?? "").trim();
  const webhookSecretInput = String(formData.get("resend_webhook_secret") ?? "").trim();
  const admin = createAdminClient();
  const { data: existingSecrets } = await admin
    .from("studio_email_secrets")
    .select("resend_api_key, resend_from_email, resend_webhook_secret")
    .eq("studio_id", studio.id)
    .maybeSingle();
  const nextFromEmail = fromEmailInput || existingSecrets?.resend_from_email || null;
  const nextApiKey = apiKeyInput || existingSecrets?.resend_api_key || null;
  const nextWebhookSecret = webhookSecretInput || existingSecrets?.resend_webhook_secret || null;
  const hasFromEmail = Boolean(nextFromEmail?.includes("@"));
  const hasApiKey = Boolean(nextApiKey);
  const hasWebhookSecret = Boolean(nextWebhookSecret);

  if (enabled && !hasFromEmail) {
    return {
      ok: false,
      message: "A verified From address is required before enabling Resend for this studio.",
      enabled: false,
      hasFromEmail,
      hasApiKey,
      hasWebhookSecret,
    };
  }
  if (enabled && (!hasApiKey || !hasWebhookSecret)) {
    return {
      ok: false,
      message: "API key and webhook signing secret are both required before enabling Resend.",
      enabled: false,
      hasFromEmail,
      hasApiKey,
      hasWebhookSecret,
    };
  }

  const { error } = await admin
    .from("studios")
    .update({ resend_enabled: enabled })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return {
      ok: false,
      message: "Could not save email settings.",
      enabled,
      hasFromEmail,
      hasApiKey,
      hasWebhookSecret,
    };
  }
  const { error: secretError } = await admin
    .from("studio_email_secrets")
    .upsert({
      studio_id: studio.id,
      resend_api_key: nextApiKey,
      resend_from_email: nextFromEmail,
      resend_webhook_secret: nextWebhookSecret,
      updated_at: new Date().toISOString(),
    });
  if (secretError) {
    console.error(secretError.message);
    return {
      ok: false,
      message: "Could not save Resend credentials.",
      enabled,
      hasFromEmail,
      hasApiKey,
      hasWebhookSecret,
    };
  }

  revalidateDashboardSettings("email");
  return {
    ok: true,
    message: enabled
      ? "Resend settings saved. This studio can send campaigns, appointment mail, and invoices."
      : "Resend settings saved.",
    enabled,
    hasFromEmail,
    hasApiKey,
    hasWebhookSecret,
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
  const { studio, ctx } = await requireStudio(studioId || undefined);
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

  const admin = createAdminClient();
  const { error } = await admin
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
  const { studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const rawUrl = logoUrl ? logoUrl.trim() : null;
  const url = sanitizeTrustedLogoUrl(rawUrl);
  if (rawUrl && !url) return;

  const admin = createAdminClient();
  const { error } = await admin
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
  const { studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const public_brand_name = String(formData.get("public_brand_name") ?? "").trim() || null;
  const rawLogoUrl = String(formData.get("public_logo_url") ?? "").trim() || null;
  const public_logo_url = sanitizeTrustedLogoUrl(rawLogoUrl);
  if (rawLogoUrl && !public_logo_url) return;

  const admin = createAdminClient();
  const { error } = await admin
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

/**
 * Save a location's operating hours for the week in one submission. Each
 * weekday is independent: a checked "closed" box marks that day fully
 * closed; a non-empty interval text updates that day's open hours; a
 * blank, non-closed day is left untouched (no RPC call), so partially
 * filling in the form does not wipe out days the user did not intend to
 * change. Scope (Owner / all-location Manager / the location's own
 * Location Manager) is re-verified inside setLocationOperatingHoursForWeekday.
 */
export async function setLocationOperatingHoursWeekAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  if (!studioId || !locationId) return err("Please fill the required fields.");

  const payload: Array<{
    weekday: number;
    isClosed: boolean;
    intervals: Array<{ opens_at: string; closes_at: string }>;
  }> = [];

  for (const weekday of WEEKDAYS) {
    const isClosed = formData.get(`closed_${weekday}`) === "on";
    const ranges = parseTimeRangeList(formData.get(`weekday_${weekday}`));
    if (ranges === null) {
      return err(`Invalid time range for ${WEEKDAY_LABELS[weekday]}. Use HH:MM-HH:MM, comma separated.`);
    }
    if (!isClosed && ranges.length === 0) continue;
    payload.push({
      weekday,
      isClosed,
      intervals: isClosed ? [] : ranges.map((range) => ({ opens_at: range.start, closes_at: range.end })),
    });
  }

  if (payload.length === 0) return ok("No operating-hours changes submitted.");

  const { user } = await requireUser();
  const result = await setLocationOperatingHoursForWeek({
    userId: user.id,
    studioId,
    locationId,
    days: payload,
  });
  if (!result.ok) return err(result.message ?? "Could not save operating hours.");

  revalidateDashboardSettings("locations");
  return ok("Operating hours saved.");
}

export async function publishStudioPrivacyNoticeAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!studioId) return err("Missing studio.");
  const { user } = await requireUser();
  const result = await publishPrivacyNotice({ userId: user.id, studioId });
  if (!result.ok) return err(result.message ?? result.reason);
  revalidateDashboardSettings("privacy");
  const { data: studio } = await createAdminClient().from("studios").select("public_slug").eq("id", studioId).maybeSingle();
  if (studio?.public_slug) revalidatePublicStudioPath(studio.public_slug);
  return ok(`Privacy notice published as ${result.versionLabel}.`);
}

export async function updateStudioRetentionSettingsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const customerDays = Number.parseInt(String(formData.get("customer_retention_days") ?? ""), 10);
  const appointmentDays = Number.parseInt(String(formData.get("appointment_retention_days") ?? ""), 10);
  if (!studioId) return err("Missing studio.");
  const { user } = await requireUser();
  const result = await updateStudioRetentionSettings({
    userId: user.id,
    studioId,
    customerRetentionDays: customerDays,
    appointmentRetentionDays: appointmentDays,
  });
  if (!result.ok) return err(result.message ?? result.reason);
  revalidateDashboardSettings("privacy");
  return ok("Retention rules saved.");
}

export async function markAppointmentRetentionReviewedAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const appointmentId = String(formData.get("appointment_id") ?? "").trim();
  if (!studioId || !appointmentId) return err("Missing appointment.");
  const { user } = await requireUser();
  const result = await markAppointmentRetentionReviewed({
    userId: user.id,
    studioId,
    appointmentId,
  });
  if (!result.ok) return err(result.message ?? result.reason);
  revalidateDashboardSettings("privacy");
  return ok("Appointment marked as retention-reviewed.");
}

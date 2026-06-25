"use server";

import { revalidateDashboardContent, revalidatePublicSectionPaths } from "@/lib/revalidatePublic";
import { recordStudioContentUpdate } from "@/lib/pwaUpdates";
import { isStudioContractSuspended } from "@/lib/studio-contract";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { hasValidMemberZonePurchasePrice } from "@/lib/memberZoneAccess";
import {
  generateUniqueShareSlug,
  hasStudioGlobalRole,
  requireStudio,
  sanitizePriceNullable,
  sanitizeVideoUrl,
} from "./shared";

export async function createMemberZoneSeries(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

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
  const price = sanitizePriceNullable(formData.get("price"));
  const currency = STUDIO_CURRENCY;
  const sort_order = Number(formData.get("sort_order") ?? 100);
  if (!hasValidMemberZonePurchasePrice(access_type, price)) return;
  const share_slug = await generateUniqueShareSlug(supabase, "member_zone_series", studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("member_zone_series").insert({
    studio_id: studio.id,
    title,
    summary,
    description,
    cover_image_url,
    promo_video_url,
    access_type,
    price: access_type === "paid_only" || access_type === "member_or_paid" ? price : null,
    currency,
    sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
    share_slug,
    is_active: true,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("member-zone");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "member-zone", share_slug);
  await recordStudioContentUpdate(studio.id, "member-zone");
}

export async function updateMemberZoneSeries(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

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
  const price = sanitizePriceNullable(formData.get("price"));
  const currency = STUDIO_CURRENCY;
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";
  if (!hasValidMemberZonePurchasePrice(access_type, price)) return;
  const { data: existingSeries } = await supabase
    .from("member_zone_series")
    .select("share_slug")
    .eq("id", seriesId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  const { error } = await supabase
    .from("member_zone_series")
    .update({
      title,
      summary,
      description,
      cover_image_url,
      promo_video_url,
      access_type,
      price: access_type === "paid_only" || access_type === "member_or_paid" ? price : null,
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
  revalidateDashboardContent("member-zone");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "member-zone", existingSeries?.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "member-zone");
}

export async function deleteMemberZoneSeries(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: existingSeries } = await supabase
    .from("member_zone_series")
    .select("share_slug")
    .eq("id", seriesId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  const { error } = await supabase
    .from("member_zone_series")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", seriesId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("member-zone");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "member-zone", existingSeries?.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "member-zone");
}

export async function createMemberZoneLesson(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: series } = await supabase
    .from("member_zone_series")
    .select("id, share_slug")
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
  const override_price = sanitizePriceNullable(formData.get("override_price"));
  const currency = STUDIO_CURRENCY;
  const sort_order = Number(formData.get("sort_order") ?? 100);
  if (access_override !== "inherit" && !hasValidMemberZonePurchasePrice(access_override, override_price)) return;

  const { error } = await supabase.from("member_zone_lessons").insert({
    series_id: series.id,
    title,
    summary,
    description,
    media_url,
    media_type,
    duration_min: Number.isFinite(durationMin) ? Math.max(0, Math.floor(durationMin)) : 0,
    access_override,
    override_price: access_override === "paid_only" || access_override === "member_or_paid" ? override_price : null,
    currency,
    sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
    is_active: true,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("member-zone");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "member-zone", series.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "member-zone");
}

export async function updateMemberZoneLesson(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const lessonId = String(formData.get("lesson_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId || !lessonId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: series } = await supabase
    .from("member_zone_series")
    .select("id, share_slug")
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
  const override_price = sanitizePriceNullable(formData.get("override_price"));
  const currency = STUDIO_CURRENCY;
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";
  if (access_override !== "inherit" && !hasValidMemberZonePurchasePrice(access_override, override_price)) return;

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
      override_price: access_override === "paid_only" || access_override === "member_or_paid" ? override_price : null,
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
  revalidateDashboardContent("member-zone");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "member-zone", series.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "member-zone");
}

export async function deleteMemberZoneLesson(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const lessonId = String(formData.get("lesson_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !seriesId || !lessonId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioGlobalRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: series } = await supabase
    .from("member_zone_series")
    .select("id, share_slug")
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
  revalidateDashboardContent("member-zone");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "member-zone", series.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "member-zone");
}

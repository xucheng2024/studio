"use server";

import {
  revalidateDashboardContent,
  revalidatePublicSectionPaths,
} from "@/lib/revalidatePublic";
import { parsePublicTagsInput } from "@/lib/publicTags";
import { recordStudioContentUpdate } from "@/lib/pwaUpdates";
import { isStudioContractSuspended } from "@/lib/studio-contract";
import { STUDIO_CURRENCY } from "@/lib/currency";
import {
  assertLocationInStudio,
  generateUniqueShareSlug,
  hasStudioRole,
  requireStudio,
  sanitizePriceNullable,
  sanitizeVideoUrl,
} from "./shared";

export async function createStudioService(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = sanitizePriceNullable(formData.get("price"));
  const currency = STUDIO_CURRENCY;
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("video_url") ?? "");
  const video_url = sanitizeVideoUrl(rawVideo);
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  if (rawVideo.trim() && !video_url) return;
  const share_slug = await generateUniqueShareSlug(supabase, "studio_services", studio.id);
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

  revalidateDashboardContent("services");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "services", share_slug);
  await recordStudioContentUpdate(studio.id, "services");
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
  const price = sanitizePriceNullable(formData.get("price"));
  const currency = STUDIO_CURRENCY;
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("video_url") ?? "");
  const video_url = sanitizeVideoUrl(rawVideo);
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";
  if (rawVideo.trim() && !video_url) return;
  const { data: existingService } = await supabase
    .from("studio_services")
    .select("share_slug")
    .eq("id", serviceId)
    .eq("studio_id", studio.id)
    .maybeSingle();

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

  revalidateDashboardContent("services");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "services", existingService?.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "services");
}

export async function deleteStudioService(formData: FormData): Promise<void> {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!serviceId || !studioId) return;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  const { data: existingService } = await supabase
    .from("studio_services")
    .select("share_slug")
    .eq("id", serviceId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  const { error } = await supabase
    .from("studio_services")
    .delete()
    .eq("id", serviceId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }

  revalidateDashboardContent("services");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "services", existingService?.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "services");
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
  const expiry_days = expiry_days_raw === "" || expiry_days_raw === null ? null : Number(expiry_days_raw);

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
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("packages");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "packages");
  await recordStudioContentUpdate(studio.id, "packages");
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

  const share_slug = await generateUniqueShareSlug(supabase, "membership_products", studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("membership_products").insert({
    studio_id: studio.id,
    location_id: locationId || null,
    name,
    description,
    price,
    currency: STUDIO_CURRENCY,
    billing_interval,
    is_active: true,
    share_slug,
    trial_days,
  });
  if (error) {
    console.error(error.message);
    return;
  }

  revalidateDashboardContent("memberships");
  if (studio.public_slug) {
    revalidatePublicSectionPaths(studio.public_slug, "memberships", share_slug);
  }
}

function sanitizeShopPrice(raw: FormDataEntryValue | null): number | null {
  if (raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

function sanitizeStockQtyNullable(raw: FormDataEntryValue | null): number | null {
  if (raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function parseImageUrlsField(raw: FormDataEntryValue | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((url): url is string => typeof url === "string" && url.startsWith("http")).slice(0, 5);
  } catch {
    return [];
  }
}

export async function createShopProduct(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const price = sanitizeShopPrice(formData.get("price"));
  if (price === null) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const image_urls = parseImageUrlsField(formData.get("image_urls"));
  const currency = STUDIO_CURRENCY;
  const stock_qty = sanitizeStockQtyNullable(formData.get("stock_qty"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const share_slug = await generateUniqueShareSlug(supabase, "shop_products", studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("shop_products").insert({
    studio_id: studio.id,
    title,
    summary,
    description,
    image_url,
    image_urls,
    price,
    currency,
    stock_qty,
    sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
    share_slug,
    is_active: true,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("shop");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "shop", share_slug);
  await recordStudioContentUpdate(studio.id, "shop");
}

export async function updateShopProduct(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !productId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const price = sanitizeShopPrice(formData.get("price"));
  if (price === null) return;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const image_urls = parseImageUrlsField(formData.get("image_urls"));
  const currency = STUDIO_CURRENCY;
  const stock_qty = sanitizeStockQtyNullable(formData.get("stock_qty"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";
  const { data: existingProduct } = await supabase
    .from("shop_products")
    .select("share_slug")
    .eq("id", productId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  const { error } = await supabase
    .from("shop_products")
    .update({
      title,
      summary,
      description,
      image_url,
      image_urls,
      price,
      currency,
      stock_qty,
      sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
      is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("shop");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "shop", existingProduct?.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "shop");
}

export async function deleteShopProduct(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !productId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: existingProduct } = await supabase
    .from("shop_products")
    .select("share_slug")
    .eq("id", productId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  const { error } = await supabase
    .from("shop_products")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("shop");
  if (studio.public_slug) revalidatePublicSectionPaths(studio.public_slug, "shop", existingProduct?.share_slug ?? null);
  await recordStudioContentUpdate(studio.id, "shop");
}

export async function updateShopOrderFulfillment(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const orderId = String(formData.get("order_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !orderId) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const raw = String(formData.get("fulfillment_status") ?? "").trim().toLowerCase();
  const fulfillment_status =
    raw === "shipped" || raw === "cancelled" || raw === "unfulfilled" ? raw : "unfulfilled";

  const { error } = await supabase
    .from("shop_orders")
    .update({ fulfillment_status, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("shop");
}

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
  err,
  generateUniqueShareSlug,
  hasStudioGlobalRole,
  hasStudioLocationRole,
  ok,
  requireStudio,
  sanitizePriceNullable,
  sanitizeVideoUrl,
  type DashboardFormResult,
} from "./shared";

export async function createStudioService(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  const activeStudio = studio!;
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save services.");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return err("Please fill the required fields.");
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = sanitizePriceNullable(formData.get("price"));
  const currency = STUDIO_CURRENCY;
  const enable_enquiry = formData.get("enable_enquiry") === "on";
  const enable_payment = formData.get("enable_payment") === "on";
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("video_url") ?? "");
  const video_url = sanitizeVideoUrl(rawVideo);
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  if (rawVideo.trim() && !video_url) return err("Please enter a valid promo video URL.");
  if (!enable_enquiry && !enable_payment) return err("Enable enquiry or payment for this service.");
  if (enable_payment && (price == null || Number(price) < 0)) return err("Enter a valid price to enable payment.");
  const share_slug = await generateUniqueShareSlug(supabase, "studio_services", activeStudio.id);
  if (!share_slug) return err("Could not create service.");

  const { error } = await supabase.from("studio_services").insert({
    studio_id: activeStudio.id,
    title,
    summary,
    description,
    price,
    currency,
    cover_image_url,
    video_url,
    tags,
    enable_enquiry,
    enable_payment,
    share_slug,
    is_active: true,
    sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
  });
  if (error) {
    console.error(error.message);
    return err("Could not create service.");
  }

  revalidateDashboardContent("services");
  if (activeStudio.public_slug) revalidatePublicSectionPaths(activeStudio.public_slug, "services", share_slug);
  await recordStudioContentUpdate(activeStudio.id, "services");
  return ok("Service created.");
}

export async function updateStudioService(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!serviceId || !studioId) return err("Please fill the required fields.");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  const activeStudio = studio!;
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save services.");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return err("Please fill the required fields.");
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = sanitizePriceNullable(formData.get("price"));
  const currency = STUDIO_CURRENCY;
  const enable_enquiry = formData.get("enable_enquiry") === "on";
  const enable_payment = formData.get("enable_payment") === "on";
  const cover_image_url = String(formData.get("cover_image_url") ?? "").trim() || null;
  const rawVideo = String(formData.get("video_url") ?? "");
  const video_url = sanitizeVideoUrl(rawVideo);
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const is_active = formData.get("is_active") === "on";
  if (rawVideo.trim() && !video_url) return err("Please enter a valid promo video URL.");
  if (!enable_enquiry && !enable_payment) return err("Enable enquiry or payment for this service.");
  if (enable_payment && (price == null || Number(price) < 0)) return err("Enter a valid price to enable payment.");
  const { data: existingService } = await supabase
    .from("studio_services")
    .select("share_slug")
    .eq("id", serviceId)
    .eq("studio_id", activeStudio.id)
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
      enable_enquiry,
      enable_payment,
      is_active,
      sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 100,
    })
    .eq("id", serviceId)
    .eq("studio_id", activeStudio.id);
  if (error) {
    console.error(error.message);
    return err("Could not save service.");
  }

  revalidateDashboardContent("services");
  if (activeStudio.public_slug) revalidatePublicSectionPaths(activeStudio.public_slug, "services", existingService?.share_slug ?? null);
  await recordStudioContentUpdate(activeStudio.id, "services");
  return ok("Service saved.");
}

export async function deleteStudioService(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!serviceId || !studioId) return err("Please fill the required fields.");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  const activeStudio = studio!;
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save services.");
  const { data: existingService } = await supabase
    .from("studio_services")
    .select("share_slug")
    .eq("id", serviceId)
    .eq("studio_id", activeStudio.id)
    .maybeSingle();

  const { error } = await supabase
    .from("studio_services")
    .delete()
    .eq("id", serviceId)
    .eq("studio_id", activeStudio.id);
  if (error) {
    console.error(error.message);
    return err("Could not remove service.");
  }

  revalidateDashboardContent("services");
  if (activeStudio.public_slug) revalidatePublicSectionPaths(activeStudio.public_slug, "services", existingService?.share_slug ?? null);
  await recordStudioContentUpdate(activeStudio.id, "services");
  return ok("Service removed.");
}

export async function createPackage(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  const activeStudio = studio!;
  if (isStudioContractSuspended(activeStudio)) return err("Studio is suspended. Reactivate the contract first.");
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save packages.");
  if (!(await assertLocationInStudio(supabase, activeStudio.id, locationId || null))) return err("The selected location is out of scope for this package.");
  if (!hasStudioLocationRole(ctx, activeStudio.id, locationId || null, ["owner", "manager"])) return err("The selected location is out of scope for this package.");

  const name = String(formData.get("name") ?? "").trim();
  const credits = Number(formData.get("credits") ?? 0);
  const price = Number(formData.get("price") ?? 0);
  const expiry_days_raw = formData.get("expiry_days");
  const expiry_days = expiry_days_raw === "" || expiry_days_raw === null ? null : Number(expiry_days_raw);

  if (!name || !Number.isFinite(credits) || credits <= 0 || !Number.isFinite(price) || price < 0) return err("Please enter a valid package name, pass count, and price.");

  const { error } = await supabase.from("packages").insert({
    studio_id: activeStudio.id,
    location_id: locationId || null,
    name,
    credits,
    price,
    expiry_days: expiry_days != null && Number.isFinite(expiry_days) ? expiry_days : null,
    type: "class_pack",
  });
  if (error) {
    console.error(error.message);
    return err("Could not create package.");
  }
  revalidateDashboardContent("packages");
  if (activeStudio.public_slug) revalidatePublicSectionPaths(activeStudio.public_slug, "packages");
  await recordStudioContentUpdate(activeStudio.id, "packages");
  return ok("Package created.");
}

export async function createMembershipProduct(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  const activeStudio = studio!;
  if (isStudioContractSuspended(activeStudio)) return err("Studio is suspended. Reactivate the contract first.");
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save memberships.");
  if (!(await assertLocationInStudio(supabase, activeStudio.id, locationId || null))) return err("The selected location is out of scope for this membership.");
  if (!hasStudioLocationRole(ctx, activeStudio.id, locationId || null, ["owner", "manager"])) return err("The selected location is out of scope for this membership.");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const billingIntervalRaw = String(formData.get("billing_interval") ?? "").trim().toLowerCase();
  const billing_interval = billingIntervalRaw === "yearly" ? "yearly" : "monthly";
  const price = Number(formData.get("price") ?? 0);
  const trialEnabled = formData.get("trial_enabled") === "on";
  const trialDaysRaw = Number(formData.get("trial_days") ?? 0);
  const trial_days = trialEnabled && Number.isFinite(trialDaysRaw) ? Math.max(1, Math.min(60, Math.floor(trialDaysRaw))) : 0;
  if (!name || !Number.isFinite(price) || price < 0) return err("Please enter a valid membership name and price.");

  const share_slug = await generateUniqueShareSlug(supabase, "membership_products", activeStudio.id);
  if (!share_slug) return err("Could not create membership.");

  const { error } = await supabase.from("membership_products").insert({
    studio_id: activeStudio.id,
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
    return err("Could not create membership.");
  }

  revalidateDashboardContent("memberships");
  if (activeStudio.public_slug) {
    revalidatePublicSectionPaths(activeStudio.public_slug, "memberships", share_slug);
  }
  return ok("Membership created.");
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

export async function createShopProduct(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return err("Studio not found.");
  const activeStudio = studio!;
  if (isStudioContractSuspended(activeStudio)) return err("Studio is suspended. Reactivate the contract first.");
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save shop data.");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return err("Please fill the required fields.");
  const price = sanitizeShopPrice(formData.get("price"));
  if (price === null) return err("Please enter a valid title, price, and stock value.");
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const image_urls = parseImageUrlsField(formData.get("image_urls"));
  const currency = STUDIO_CURRENCY;
  const stock_qty = sanitizeStockQtyNullable(formData.get("stock_qty"));
  const sort_order = Number(formData.get("sort_order") ?? 100);
  const share_slug = await generateUniqueShareSlug(supabase, "shop_products", activeStudio.id);
  if (!share_slug) return err("Could not create product.");

  const { error } = await supabase.from("shop_products").insert({
    studio_id: activeStudio.id,
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
    return err("Could not create product.");
  }
  revalidateDashboardContent("shop");
  if (activeStudio.public_slug) revalidatePublicSectionPaths(activeStudio.public_slug, "shop", share_slug);
  await recordStudioContentUpdate(activeStudio.id, "shop");
  return ok("Product created.");
}

export async function updateShopProduct(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !productId) return err("Please fill the required fields.");
  const activeStudio = studio!;
  if (isStudioContractSuspended(activeStudio)) return err("Studio is suspended. Reactivate the contract first.");
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save shop data.");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return err("Please fill the required fields.");
  const price = sanitizeShopPrice(formData.get("price"));
  if (price === null) return err("Please enter a valid title, price, and stock value.");
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
    .eq("studio_id", activeStudio.id)
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
    .eq("studio_id", activeStudio.id);
  if (error) {
    console.error(error.message);
    return err("Could not save product.");
  }
  revalidateDashboardContent("shop");
  if (activeStudio.public_slug) revalidatePublicSectionPaths(activeStudio.public_slug, "shop", existingProduct?.share_slug ?? null);
  await recordStudioContentUpdate(activeStudio.id, "shop");
  return ok("Product saved.");
}

export async function deleteShopProduct(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !productId) return err("Please fill the required fields.");
  const activeStudio = studio!;
  if (isStudioContractSuspended(activeStudio)) return err("Studio is suspended. Reactivate the contract first.");
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save shop data.");

  const { data: existingProduct } = await supabase
    .from("shop_products")
    .select("share_slug")
    .eq("id", productId)
    .eq("studio_id", activeStudio.id)
    .maybeSingle();

  const { error } = await supabase
    .from("shop_products")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("studio_id", activeStudio.id);
  if (error) {
    console.error(error.message);
    return err("Could not hide product.");
  }
  revalidateDashboardContent("shop");
  if (activeStudio.public_slug) revalidatePublicSectionPaths(activeStudio.public_slug, "shop", existingProduct?.share_slug ?? null);
  await recordStudioContentUpdate(activeStudio.id, "shop");
  return ok("Product hidden.");
}

export async function updateShopOrderFulfillment(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const orderId = String(formData.get("order_id") ?? "").trim();
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !orderId) return err("Please fill the required fields.");
  const activeStudio = studio!;
  if (!hasStudioGlobalRole(ctx, activeStudio.id, ["owner", "manager"])) return err("You do not have permission to save shop data.");

  const raw = String(formData.get("fulfillment_status") ?? "").trim().toLowerCase();
  const fulfillment_status =
    raw === "shipped" || raw === "cancelled" || raw === "unfulfilled" ? raw : "unfulfilled";

  const { error } = await supabase
    .from("shop_orders")
    .update({ fulfillment_status, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("studio_id", activeStudio.id);
  if (error) {
    console.error(error.message);
    return err("Could not update fulfillment.");
  }
  revalidateDashboardContent("shop");
  return ok("Fulfillment updated.");
}

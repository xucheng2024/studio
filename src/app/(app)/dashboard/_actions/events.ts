"use server";

import { revalidateDashboardContent, revalidatePublicSectionPaths } from "@/lib/revalidatePublic";
import { parsePublicTagsInput } from "@/lib/publicTags";
import { recordStudioContentUpdate } from "@/lib/pwaUpdates";
import { sanitizeEventExternalBookingUrl } from "@/lib/eventBookingUrl";
import { isStudioContractSuspended } from "@/lib/studio-contract";
import { parseDatetimeLocalAsSgt } from "@/lib/date";
import { STUDIO_CURRENCY } from "@/lib/currency";
import {
  assertLocationInStudio,
  generateUniqueShareSlug,
  hasStudioLocationRole,
  hasStudioRole,
  requireStudio,
  sanitizePriceNullable,
  sanitizeVideoUrl,
} from "./shared";

export async function createEvent(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) return;
  if (!hasStudioLocationRole(ctx, studio.id, locationId, ["owner", "manager"])) return;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const address_details = String(formData.get("address_details") ?? "").trim() || null;
  const tags = parsePublicTagsInput(formData.get("tags_input"));
  const startRaw = String(formData.get("start_time") ?? "");
  const endRaw = String(formData.get("end_time") ?? "");
  const capacity = Number(formData.get("capacity") ?? 0);
  const price = sanitizePriceNullable(formData.get("price"));
  const currency = STUDIO_CURRENCY;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const video_url = sanitizeVideoUrl(String(formData.get("video_url") ?? "")) || null;
  const external_booking_url = sanitizeEventExternalBookingUrl(String(formData.get("external_booking_url") ?? ""));

  if (!title) return;
  if (!Number.isFinite(capacity) || capacity <= 0) return;
  if (price != null && price < 0) return;

  const start = parseDatetimeLocalAsSgt(startRaw);
  const end = parseDatetimeLocalAsSgt(endRaw);
  if (!start || !end) return;
  if (!(end.getTime() > start.getTime())) return;

  const share_slug = await generateUniqueShareSlug(supabase, "events", studio.id);
  if (!share_slug) return;

  const { error } = await supabase.from("events").insert({
    studio_id: studio.id,
    location_id: locationId,
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
    external_booking_url,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("events");
  const publicSlug = String(studio.public_slug ?? "").trim();
  if (publicSlug) {
    revalidatePublicSectionPaths(publicSlug, "events", share_slug);
  }
  await recordStudioContentUpdate(studio.id, "events");
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
  const price = sanitizePriceNullable(formData.get("price"));
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const video_url = sanitizeVideoUrl(String(formData.get("video_url") ?? "")) || null;
  const external_booking_url = sanitizeEventExternalBookingUrl(String(formData.get("external_booking_url") ?? ""));

  if (!title) return;
  if (!Number.isFinite(capacity) || capacity <= 0) return;
  if (price != null && price < 0) return;
  const start = parseDatetimeLocalAsSgt(startRaw);
  const end = parseDatetimeLocalAsSgt(endRaw);
  if (!start || !end) return;
  if (!(end.getTime() > start.getTime())) return;

  const { data: existing } = await supabase
    .from("events")
    .select("id, studio_id, location_id, capacity, spots_left, share_slug")
    .eq("id", eventId)
    .maybeSingle();
  if (!existing || existing.studio_id !== studio.id) return;
  if (!(await assertLocationInStudio(supabase, studio.id, existing.location_id ?? null))) return;
  if (!hasStudioLocationRole(ctx, studio.id, existing.location_id ?? null, ["owner", "manager"])) return;

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
      external_booking_url,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("events");
  const publicSlug = String(studio.public_slug ?? "").trim();
  const eventSlug = String(existing.share_slug ?? "").trim();
  if (publicSlug) {
    revalidatePublicSectionPaths(publicSlug, "events", eventSlug);
  }
  await recordStudioContentUpdate(studio.id, "events");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const eventId = String(formData.get("event_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !eventId) return;
  if (isStudioContractSuspended(studio)) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;

  const { data: existing } = await supabase
    .from("events")
    .select("id, studio_id, location_id, share_slug")
    .eq("id", eventId)
    .maybeSingle();
  if (!existing || existing.studio_id !== studio.id) return;
  if (!(await assertLocationInStudio(supabase, studio.id, existing.location_id ?? null))) return;
  if (!hasStudioLocationRole(ctx, studio.id, existing.location_id ?? null, ["owner", "manager"])) return;

  const { error } = await supabase
    .from("events")
    .update({ is_active: false })
    .eq("id", eventId)
    .eq("studio_id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("events");
  if (studio.public_slug) {
    revalidatePublicSectionPaths(studio.public_slug, "events", existing.share_slug ?? null);
  }
  await recordStudioContentUpdate(studio.id, "events");
}

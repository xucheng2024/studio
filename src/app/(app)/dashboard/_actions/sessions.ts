"use server";

import { revalidateDashboardContent, revalidatePublicSectionPaths } from "@/lib/revalidatePublic";
import { parsePublicTagsInput } from "@/lib/publicTags";
import { recordStudioContentUpdate } from "@/lib/pwaUpdates";
import { parseDateAndTimeAsSgt, parseDatetimeLocalAsSgt } from "@/lib/date";
import { isStudioContractSuspended } from "@/lib/studio-contract";
import {
  assertLocationInStudio,
  hasStudioRole,
  requireStudio,
  sanitizePriceNullable,
  sanitizeVideoUrl,
  type SupabaseClient,
} from "./shared";

type SessionPricing = {
  guest_price: number | null;
  credits_required: number | null;
  address: string | null;
  address_details: string | null;
};

type LoadedClass = {
  id: string;
  title: string | null;
  description?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  duration_min: number;
  capacity: number;
  location_id: string | null;
};

async function insertOneTimeSession(
  supabase: SupabaseClient,
  cls: LoadedClass,
  locationId: string,
  startDate: Date,
  pricing: SessionPricing,
): Promise<boolean> {
  const endDate = new Date(startDate.getTime() + cls.duration_min * 60000);
  const { error } = await supabase.from("class_sessions").insert({
    class_id: cls.id,
    location_id: locationId || cls.location_id || null,
    class_title_snapshot: cls.title,
    class_description_snapshot: cls.description ?? null,
    class_image_url_snapshot: cls.image_url ?? null,
    class_video_url_snapshot: cls.video_url ?? null,
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    capacity: cls.capacity,
    guest_price: pricing.guest_price,
    credits_required: pricing.credits_required != null ? Math.floor(pricing.credits_required) : null,
    status: "scheduled",
    spots_left: cls.capacity,
    address: pricing.address,
    address_details: pricing.address_details,
  });
  if (error) {
    console.error("insertOneTimeSession:", error.message);
    return false;
  }
  return true;
}

async function insertRecurringRule(
  supabase: SupabaseClient,
  cls: LoadedClass,
  locationId: string,
  opts: {
    byWeekday: string;
    startDate: string;
    endDate: string;
    startTime: string;
    duration: number;
    capacity: number;
  },
  pricing: SessionPricing,
): Promise<number> {
  const { byWeekday, startDate, endDate, startTime, duration, capacity } = opts;

  const { data: rule, error } = await supabase
    .from("recurring_rules")
    .insert({
      class_id: cls.id,
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
  if (error || !rule) {
    console.error("insertRecurringRule:", error?.message);
    return -1;
  }

  const weekdays = byWeekday.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const weekdayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const targetDays = weekdays.length ? weekdays.map((weekday) => weekdayMap[weekday]).filter((day) => day != null) : [];
  const horizonEndExclusive = new Date(startDate);
  horizonEndExclusive.setDate(horizonEndExclusive.getDate() + 56);
  const hardEnd = endDate ? new Date(endDate) : horizonEndExclusive;
  const end = hardEnd < horizonEndExclusive ? hardEnd : horizonEndExclusive;

  let count = 0;
  const cursor = new Date(startDate);
  while (cursor < end) {
    const dayOfWeek = cursor.getDay();
    if (targetDays.length === 0 || targetDays.includes(dayOfWeek)) {
      const sessionStart = parseDateAndTimeAsSgt(cursor.toISOString().slice(0, 10), startTime);
      if (!sessionStart) {
        console.error("insertRecurringRule: invalid_start_time", startDate, startTime);
        return -1;
      }
      const sessionEnd = new Date(sessionStart.getTime() + duration * 60000);
      const existingSession = await supabase
        .from("class_sessions")
        .select("id")
        .eq("class_id", cls.id)
        .eq("location_id", locationId)
        .eq("start_time", sessionStart.toISOString())
        .maybeSingle();
      if (!existingSession.data) {
        const { error: insertError } = await supabase.from("class_sessions").insert({
          class_id: cls.id,
          location_id: locationId,
          class_title_snapshot: cls.title,
          class_description_snapshot: cls.description ?? null,
          class_image_url_snapshot: cls.image_url ?? null,
          class_video_url_snapshot: cls.video_url ?? null,
          start_time: sessionStart.toISOString(),
          end_time: sessionEnd.toISOString(),
          capacity,
          guest_price: pricing.guest_price,
          credits_required: pricing.credits_required != null ? Math.floor(pricing.credits_required) : null,
          spots_left: capacity,
          status: "scheduled",
          recurring_rule_id: rule.id,
          address: pricing.address,
          address_details: pricing.address_details,
        });
        if (insertError) {
          console.error("insertRecurringRule: session insert failed", insertError.message, sessionStart.toISOString());
          return -1;
        }
        count++;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
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
  revalidateDashboardContent("classes");
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
    const { data: instructor } = await supabase
      .from("instructors")
      .select("id, studio_id, location_id")
      .eq("id", instructor_id)
      .maybeSingle();
    if (!instructor || instructor.studio_id !== studio.id) return;
    if (locationId && instructor.location_id && instructor.location_id !== locationId) return;
  }

  const { error } = await supabase.from("classes").insert({
    studio_id: studio.id,
    location_id: locationId || null,
    title,
    description: description || null,
    capacity: Number.isFinite(capacity) ? capacity : 10,
    duration_min: Number.isFinite(duration_min) ? duration_min : 60,
    instructor_id: instructor_id || null,
    tags,
    image_url,
    video_url,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidateDashboardContent("classes");
}

export type SessionPanelResult = { ok: boolean; message: string };

const SESSION_PANEL_ERR: SessionPanelResult = {
  ok: false,
  message: "Something went wrong. Please check your inputs and try again.",
};

export async function createSessionWithTemplate(
  _prevState: SessionPanelResult | null,
  formData: FormData,
): Promise<SessionPanelResult> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const sessionType = String(formData.get("session_type") ?? "once");
  const classIdRaw = String(formData.get("class_id") ?? "").trim();
  const isNewClass = classIdRaw === "new";

  const guest_price = sanitizePriceNullable(formData.get("guest_price"));
  const creditsRaw = String(formData.get("credits_required") ?? "").trim();
  const credits_required = creditsRaw === "" ? null : Number(creditsRaw);
  const address = String(formData.get("address") ?? "").trim() || null;
  const address_details = String(formData.get("address_details") ?? "").trim() || null;
  if (credits_required != null && (!Number.isFinite(credits_required) || credits_required <= 0)) return SESSION_PANEL_ERR;

  const newClassTitle = isNewClass ? String(formData.get("new_class_title") ?? "").trim() : "";
  const newClassDuration = isNewClass ? Number(formData.get("new_class_duration_min") ?? 60) : 60;
  const newClassCapacity = isNewClass ? Number(formData.get("new_class_capacity") ?? 10) : 10;
  const newClassDescription = isNewClass ? String(formData.get("new_class_description") ?? "").trim() || null : null;
  const newClassTags = isNewClass ? parsePublicTagsInput(formData.get("new_class_tags_input")) : [];
  const newClassImageUrl = isNewClass ? String(formData.get("new_class_image_url") ?? "").trim() || null : null;
  const newClassVideoUrl = isNewClass ? sanitizeVideoUrl(String(formData.get("new_class_video_url") ?? "")) : null;
  if (isNewClass && !newClassTitle) return SESSION_PANEL_ERR;

  let weeklyFields: {
    byWeekday: string;
    startDate: string;
    endDate: string;
    startTime: string;
    duration: number;
    capacity: number;
  } | null = null;

  if (sessionType === "weekly") {
    if (!locationId) return SESSION_PANEL_ERR;
    const byWeekday = String(formData.get("by_weekday") ?? "");
    const startDate = String(formData.get("start_date") ?? "");
    const endDate = String(formData.get("end_date") ?? "");
    const startTime = String(formData.get("start_time") ?? "");
    const duration = Number(formData.get("duration_min") ?? 60);
    const capacity = Number(formData.get("capacity") ?? 10);
    if (!startDate || !startTime || !byWeekday) return SESSION_PANEL_ERR;
    weeklyFields = { byWeekday, startDate, endDate, startTime, duration, capacity };
  }

  let onceStartDate: Date | null = null;
  if (sessionType === "once") {
    const start = String(formData.get("start_time") ?? "");
    if (!start) return SESSION_PANEL_ERR;
    onceStartDate = parseDatetimeLocalAsSgt(start);
    if (!onceStartDate) return SESSION_PANEL_ERR;
  }

  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return SESSION_PANEL_ERR;
  if (isStudioContractSuspended(studio)) return SESSION_PANEL_ERR;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId || null))) return SESSION_PANEL_ERR;

  const requiresManagerRole = isNewClass || sessionType === "weekly";
  if (requiresManagerRole) {
    if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return SESSION_PANEL_ERR;
  } else {
    if (!hasStudioRole(ctx, studio.id, ["owner", "manager", "frontdesk"])) return SESSION_PANEL_ERR;
  }

  let classId = isNewClass ? "" : classIdRaw;
  if (isNewClass) {
    const { data: newClass, error } = await supabase
      .from("classes")
      .insert({
        studio_id: studio.id,
        location_id: locationId || null,
        title: newClassTitle,
        description: newClassDescription,
        capacity: Number.isFinite(newClassCapacity) ? newClassCapacity : 10,
        duration_min: Number.isFinite(newClassDuration) ? newClassDuration : 60,
        tags: newClassTags,
        image_url: newClassImageUrl,
        video_url: newClassVideoUrl,
      })
      .select("id")
      .single();
    if (error || !newClass) {
      console.error("createSessionWithTemplate: failed to create class", error?.message);
      return { ok: false, message: "Failed to create class. Please try again." };
    }
    classId = newClass.id;
    revalidateDashboardContent("classes");
  }
  if (!classId) return SESSION_PANEL_ERR;

  const pricing: SessionPricing = { guest_price, credits_required, address, address_details };
  const classPrefix = isNewClass ? `New class "${newClassTitle}" created · ` : "";

  if (sessionType === "once" && onceStartDate) {
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select("id, title, description, image_url, video_url, duration_min, capacity, studio_id, location_id, is_active")
      .eq("id", classId)
      .single();
    if (classError || !cls || cls.studio_id !== studio.id) return SESSION_PANEL_ERR;
    if (cls.is_active === false) return SESSION_PANEL_ERR;
    if (locationId && cls.location_id && cls.location_id !== locationId) return SESSION_PANEL_ERR;

    const ok = await insertOneTimeSession(supabase, cls, locationId, onceStartDate, pricing);
    if (!ok) return { ok: false, message: "Failed to create session. Please try again." };

    revalidateDashboardContent("classes");
    if (studio.public_slug) {
      revalidatePublicSectionPaths(studio.public_slug, "classes");
    }
    await recordStudioContentUpdate(studio.id, "classes");
    return { ok: true, message: `${classPrefix}1 session scheduled` };
  }

  if (sessionType === "weekly" && weeklyFields) {
    const { data: cls } = await supabase
      .from("classes")
      .select("id, title, description, image_url, video_url, studio_id, location_id, is_active, duration_min, capacity")
      .eq("id", classId)
      .maybeSingle();
    if (!cls || cls.studio_id !== studio.id) return SESSION_PANEL_ERR;
    if (cls.is_active === false) return SESSION_PANEL_ERR;
    if (cls.location_id && cls.location_id !== locationId) return SESSION_PANEL_ERR;

    const count = await insertRecurringRule(supabase, cls, locationId, weeklyFields, pricing);
    if (count < 0) return { ok: false, message: "Failed to create recurring schedule. Please try again." };

    revalidateDashboardContent("classes");
    if (studio.public_slug) {
      revalidatePublicSectionPaths(studio.public_slug, "classes");
    }
    await recordStudioContentUpdate(studio.id, "classes");
    const classTitle = cls.title ?? newClassTitle;
    return {
      ok: true,
      message: `${classPrefix}${count} session${count !== 1 ? "s" : ""} scheduled${classTitle ? ` (${classTitle})` : ""}`,
    };
  }

  return SESSION_PANEL_ERR;
}

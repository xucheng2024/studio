"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildAccessContext } from "@/lib/rbac";
import { normalizeStudioSlug } from "@/lib/slug";
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
  const ctx = await buildAccessContext({ userId: user.id });
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
    .select("id, name, public_slug")
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
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "owner") {
    console.error("createStudio: only studio owners can create a venue");
    return;
  }

  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("public_slug") ?? "");
  const public_slug = normalizeStudioSlug(slugRaw);
  if (!name || !public_slug) return;

  const { error } = await supabase.from("studios").insert({
    name,
    owner_id: user.id,
    public_slug,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard");
  revalidatePath(`/booking/${public_slug}`);
}

export async function updateStudioSlug(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner"])) return;
  const slugRaw = String(formData.get("public_slug") ?? "");
  const public_slug = normalizeStudioSlug(slugRaw);
  if (!public_slug) return;

  const { error } = await supabase
    .from("studios")
    .update({ public_slug })
    .eq("id", studio.id);
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/qr");
  revalidatePath(`/booking/${public_slug}`);
  revalidatePath(`/booking/${studio.public_slug}`);
}

export async function createInstructor(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
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
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId || null))) return;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const capacity = Number(formData.get("capacity") ?? 10);
  const duration_min = Number(formData.get("duration_min") ?? 60);
  const instructor_id = String(formData.get("instructor_id") ?? "").trim();

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
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager", "frontdesk"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId || null))) return;

  const class_id = String(formData.get("class_id") ?? "");
  const start = String(formData.get("start_time") ?? "");
  if (!class_id || !start) return;

  const { data: cls, error: cErr } = await supabase
    .from("classes")
    .select("id, duration_min, capacity, studio_id, location_id")
    .eq("id", class_id)
    .single();

  if (cErr || !cls || cls.studio_id !== studio.id) {
    return;
  }
  if (locationId && cls.location_id && cls.location_id !== locationId) return;

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return;
  const endDate = new Date(startDate.getTime() + cls.duration_min * 60000);

  const { error } = await supabase.from("class_sessions").insert({
    class_id: cls.id,
    location_id: locationId || cls.location_id || null,
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    capacity: cls.capacity,
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
  const is_drop_in = formData.get("is_drop_in") === "on";

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
    is_drop_in,
    type: is_drop_in ? "single" : "class_pack",
  });
  if (error) {
    console.error(error.message);
    return;
  }
  revalidatePath("/dashboard/packages");
  revalidatePath("/checkout");
}

export async function markAttended(bookingId: string): Promise<void> {
  const { supabase, studio, user, ctx } = await requireStudio();
  if (!studio) return;
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

  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio || !locationId || !classId || !startDate || !startTime) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) return;
  const { data: cls } = await supabase
    .from("classes")
    .select("id, studio_id, location_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls || cls.studio_id !== studio.id) return;
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
          start_time: st.toISOString(),
          end_time: en.toISOString(),
          capacity,
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

export async function saveBookingRules(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const locationRaw = String(formData.get("location_id") ?? "").trim();
  const locationId = locationRaw || null;
  const cancelCutoff = Number(formData.get("cancel_cutoff_hours") ?? 12);
  const noShowBuffer = Number(formData.get("no_show_buffer_min") ?? 15);
  const maxActiveBookings = Number(formData.get("max_active_bookings_per_client") ?? 3);
  const maxWeeklyLate = Number(formData.get("max_weekly_late_cancel") ?? 2);
  const lateCancelDeductCredit = formData.get("late_cancel_deduct_credit") === "on";
  const noShowDeductCredit = formData.get("no_show_deduct_credit") === "on";
  const allowWaitlist = formData.get("allow_waitlist") === "on";

  const { supabase, studio, ctx } = await requireStudio(studioId || undefined);
  if (!studio) return;
  if (!hasStudioRole(ctx, studio.id, ["owner", "manager"])) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) return;

  const scopeQuery = supabase
    .from("booking_rules")
    .select("id")
    .eq("studio_id", studio.id)
    .limit(1);
  const { data: existing } = locationId
    ? await scopeQuery.eq("location_id", locationId).maybeSingle()
    : await scopeQuery.is("location_id", null).maybeSingle();

  const payload = {
    studio_id: studio.id,
    location_id: locationId,
    cancel_cutoff_hours: Number.isFinite(cancelCutoff) ? Math.max(cancelCutoff, 0) : 12,
    no_show_buffer_min: Number.isFinite(noShowBuffer) ? Math.max(noShowBuffer, 0) : 15,
    max_active_bookings_per_client: Number.isFinite(maxActiveBookings)
      ? Math.max(maxActiveBookings, 1)
      : 3,
    max_weekly_late_cancel: Number.isFinite(maxWeeklyLate) ? Math.max(maxWeeklyLate, 0) : 2,
    late_cancel_deduct_credit: lateCancelDeductCredit,
    no_show_deduct_credit: noShowDeductCredit,
    allow_waitlist: allowWaitlist,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await supabase.from("booking_rules").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("booking_rules").insert(payload);
  }

  revalidatePath("/dashboard/schedule");
}

export async function createStaffMembership(formData: FormData): Promise<void> {
  const studioId = String(formData.get("studio_id") ?? "");
  const userId = String(formData.get("user_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const locationRaw = String(formData.get("location_id") ?? "").trim();
  const locationId = locationRaw || null;
  const { supabase, studio, user } = await requireStudio(studioId || undefined);
  if (!studio || !userId || !role) return;
  if (user.id === userId && role !== "owner") return;

  const { data: me } = await supabase
    .from("studios")
    .select("id")
    .eq("id", studio.id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!me) return;
  if (!(await assertLocationInStudio(supabase, studio.id, locationId))) return;

  await supabase.from("staff_memberships").insert({
    user_id: userId,
    studio_id: studio.id,
    location_id: locationId,
    role,
    is_active: true,
  });

  revalidatePath("/dashboard/staff");
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
    .select("id")
    .eq("id", membership.studio_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!studio) return;
  if (membership.role === "owner") return;

  await supabase
    .from("staff_memberships")
    .update({ is_active: nextActive })
    .eq("id", membership.id);

  revalidatePath("/dashboard/staff");
}

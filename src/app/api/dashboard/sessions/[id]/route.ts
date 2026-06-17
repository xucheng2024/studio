import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordStudioContentUpdate } from "@/lib/pwaUpdates";
import { revalidateDashboardContent, revalidatePublicSectionPaths } from "@/lib/revalidatePublic";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  start_time: z.string().datetime().optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  guest_price: z.union([z.coerce.number().min(0), z.null()]).optional(),
  credits_required: z.union([z.coerce.number().int().min(1), z.null()]).optional(),
  location_id: z.string().uuid().nullable().optional(),
  address: z.string().max(4000).nullable().optional(),
  address_details: z.string().max(4000).nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("class_sessions")
    .select("id, class_id, location_id, start_time, end_time, capacity, spots_left, status, classes!inner(studio_id, duration_min, share_slug)")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if ((row as { status?: string | null }).status === "cancelled") {
    return NextResponse.json({ error: "session_cancelled" }, { status: 409 });
  }

  const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
  if (!cls?.studio_id) return NextResponse.json({ error: "invalid_session" }, { status: 409 });
  const scope = await requireStaffScope({
    userId: user.id,
    studioId: cls.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const patch: Record<string, unknown> = {};
  const nextCapacity = parsed.data.capacity ?? row.capacity;
  const usedSeats = Math.max(Number(row.capacity ?? 0) - Number(row.spots_left ?? 0), 0);
  if (nextCapacity < usedSeats) {
    return NextResponse.json({ error: "capacity_below_booked" }, { status: 409 });
  }

  if (parsed.data.capacity !== undefined) {
    patch.capacity = nextCapacity;
    patch.spots_left = Math.max(0, nextCapacity - usedSeats);
  }
  if (parsed.data.guest_price !== undefined) patch.guest_price = parsed.data.guest_price;
  if (parsed.data.credits_required !== undefined) patch.credits_required = parsed.data.credits_required;
  if (parsed.data.location_id !== undefined) {
    if (parsed.data.location_id) {
      const { data: loc } = await admin
        .from("locations")
        .select("id")
        .eq("id", parsed.data.location_id)
        .eq("studio_id", cls.studio_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!loc) return NextResponse.json({ error: "invalid_location" }, { status: 400 });
    }
    patch.location_id = parsed.data.location_id;
  }
  if (parsed.data.start_time !== undefined) {
    const startDate = new Date(parsed.data.start_time);
    if (Number.isNaN(startDate.getTime())) return NextResponse.json({ error: "invalid_start_time" }, { status: 400 });
    const duration = Number(cls.duration_min ?? 60);
    patch.start_time = startDate.toISOString();
    patch.end_time = new Date(startDate.getTime() + duration * 60000).toISOString();
  }
  if (parsed.data.address !== undefined) {
    patch.address =
      parsed.data.address == null ? null : String(parsed.data.address).trim() || null;
  }
  if (parsed.data.address_details !== undefined) {
    patch.address_details =
      parsed.data.address_details == null ? null : String(parsed.data.address_details).trim() || null;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error: uErr } = await admin.from("class_sessions").update(patch).eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  const { data: studio } = await admin.from("studios").select("public_slug").eq("id", cls.studio_id).maybeSingle();
  const classShareSlug = (cls as { share_slug?: string | null }).share_slug ?? null;
  revalidateDashboardContent("classes");
  if (studio?.public_slug) revalidatePublicSectionPaths(studio.public_slug, "classes", classShareSlug);
  await recordStudioContentUpdate(cls.studio_id, "classes");
  return NextResponse.json({ ok: true });
}

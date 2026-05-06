import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePublicTags } from "@/lib/publicTags";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).nullable().optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  duration_min: z.coerce.number().int().min(1).optional(),
  instructor_id: z.string().uuid().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
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
    .from("classes")
    .select("id, studio_id, location_id, instructor_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.capacity !== undefined) patch.capacity = parsed.data.capacity;
  if (parsed.data.duration_min !== undefined) patch.duration_min = parsed.data.duration_min;
  if (parsed.data.instructor_id !== undefined) {
    if (parsed.data.instructor_id) {
      const { data: ins } = await admin
        .from("instructors")
        .select("id, studio_id, location_id")
        .eq("id", parsed.data.instructor_id)
        .maybeSingle();
      if (!ins || ins.studio_id !== row.studio_id) {
        return NextResponse.json({ error: "invalid_instructor" }, { status: 400 });
      }
      const loc = parsed.data.location_id ?? row.location_id;
      if (loc && ins.location_id && ins.location_id !== loc) {
        return NextResponse.json({ error: "instructor_location_mismatch" }, { status: 400 });
      }
    }
    patch.instructor_id = parsed.data.instructor_id;
  }
  if (parsed.data.location_id !== undefined) {
    if (parsed.data.location_id) {
      const { data: loc } = await admin
        .from("locations")
        .select("id")
        .eq("id", parsed.data.location_id)
        .eq("studio_id", row.studio_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!loc) return NextResponse.json({ error: "invalid_location" }, { status: 400 });

      // When only location_id is patched (no instructor_id in this request),
      // re-check the existing instructor against the new location to keep them consistent.
      const effectiveInstructorId =
        parsed.data.instructor_id !== undefined
          ? parsed.data.instructor_id   // already validated above
          : (row.instructor_id as string | null | undefined);
      if (effectiveInstructorId) {
        const { data: ins } = await admin
          .from("instructors")
          .select("id, location_id")
          .eq("id", effectiveInstructorId)
          .maybeSingle();
        if (ins?.location_id && ins.location_id !== parsed.data.location_id) {
          return NextResponse.json({ error: "instructor_location_mismatch" }, { status: 400 });
        }
      }
    }
    patch.location_id = parsed.data.location_id;
  }
  if (parsed.data.tags !== undefined) {
    patch.tags = normalizePublicTags(parsed.data.tags);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error: uErr } = await admin.from("classes").update(patch).eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  revalidatePath("/dashboard/classes");
  revalidatePath("/dashboard/schedule");
  revalidatePath("/booking");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("classes")
    .select("id, studio_id, location_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const { error: dErr } = await admin
    .from("classes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  revalidatePath("/dashboard/classes");
  revalidatePath("/dashboard/schedule");
  revalidatePath("/booking");
  return NextResponse.json({ ok: true });
}

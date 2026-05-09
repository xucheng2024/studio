import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordStudioContentUpdate } from "@/lib/pwaUpdates";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  credits: z.coerce.number().int().min(1).optional(),
  price: z.coerce.number().min(0).optional(),
  expiry_days: z.coerce.number().int().min(1).nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  video_url: z.string().max(2000).nullable().optional(),
});

function sanitizeVideoUrl(raw: string | null) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return v;
  } catch {
    return null;
  }
}

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
    .from("packages")
    .select("id, studio_id, location_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if ((row as { deleted_at?: string | null }).deleted_at) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.credits !== undefined) patch.credits = parsed.data.credits;
  if (parsed.data.price !== undefined) patch.price = parsed.data.price;
  if (parsed.data.expiry_days !== undefined) patch.expiry_days = parsed.data.expiry_days;
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
    }
    patch.location_id = parsed.data.location_id;
  }
  if (parsed.data.video_url !== undefined) {
    const next = sanitizeVideoUrl(parsed.data.video_url);
    if (parsed.data.video_url && !next) {
      return NextResponse.json({ error: "invalid_video_url" }, { status: 400 });
    }
    patch.video_url = next;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error: uErr } = await admin.from("packages").update(patch).eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  revalidatePath("/dashboard/packages");
  revalidatePath("/");
  await recordStudioContentUpdate(row.studio_id, "packages");
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
    .from("packages")
    .select("id, studio_id, location_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if ((row as { deleted_at?: string | null }).deleted_at) {
    return NextResponse.json({ ok: true });
  }

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const { error: dErr } = await admin
    .from("packages")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  revalidatePath("/dashboard/packages");
  revalidatePath("/");
  return NextResponse.json({ ok: true });
}

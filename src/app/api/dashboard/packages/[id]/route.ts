import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  credits: z.coerce.number().int().min(1).optional(),
  price: z.coerce.number().min(0).optional(),
  expiry_days: z.coerce.number().int().min(1).nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
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
    .from("packages")
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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error: uErr } = await admin.from("packages").update(patch).eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  revalidatePath("/dashboard/packages");
  revalidatePath("/checkout");
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

  const { data: hasClientPackages } = await admin
    .from("client_packages")
    .select("id")
    .eq("package_id", id)
    .limit(1)
    .maybeSingle();
  if (hasClientPackages?.id) {
    return NextResponse.json({ error: "package_has_sales" }, { status: 409 });
  }

  const { data: hasPayments } = await admin
    .from("payments")
    .select("id")
    .eq("package_id", id)
    .limit(1)
    .maybeSingle();
  if (hasPayments?.id) {
    return NextResponse.json({ error: "package_has_sales" }, { status: 409 });
  }

  const { error: dErr } = await admin.from("packages").delete().eq("id", id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  revalidatePath("/dashboard/packages");
  revalidatePath("/checkout");
  return NextResponse.json({ ok: true });
}

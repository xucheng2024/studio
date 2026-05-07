import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).nullable().optional(),
  price: z.number().min(0).optional(),
  billing_interval: z.enum(["monthly", "yearly"]).optional(),
  location_id: z.string().uuid().nullable().optional(),
  trial_days: z.number().int().min(0).max(60).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("membership_products")
    .select("id, studio_id, location_id, share_slug")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const patch = {
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("membership_products").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: studio } = await admin.from("studios").select("public_slug").eq("id", row.studio_id).maybeSingle();
  revalidatePath("/dashboard/memberships");
  if (studio?.public_slug && row.share_slug) {
    revalidatePath(`/membership/${studio.public_slug}/${row.share_slug}`);
    revalidatePath(`/${studio.public_slug}`);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("membership_products")
    .select("id, studio_id, location_id, share_slug")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const { error } = await admin
    .from("membership_products")
    .update({ is_active: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: studio } = await admin.from("studios").select("public_slug").eq("id", row.studio_id).maybeSingle();
  revalidatePath("/dashboard/memberships");
  if (studio?.public_slug) revalidatePath(`/${studio.public_slug}`);
  return NextResponse.json({ ok: true });
}

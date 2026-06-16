import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  question: z.string().trim().min(1).max(300).optional(),
  answer: z.string().trim().min(1).max(6000).optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
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
  const { data: existing, error } = await admin
    .from("studio_faqs")
    .select("id, studio_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: studio } = await admin
    .from("studios")
    .select("id, public_slug")
    .eq("id", existing.studio_id)
    .maybeSingle();
  if (!studio) return NextResponse.json({ error: "studio_not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: existing.studio_id,
    roles: ["owner"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.question !== undefined) patch.question = parsed.data.question;
  if (parsed.data.answer !== undefined) patch.answer = parsed.data.answer;
  if (parsed.data.sort_order !== undefined) patch.sort_order = parsed.data.sort_order;

  const { data: row, error: updateError } = await admin
    .from("studio_faqs")
    .update(patch)
    .eq("id", id)
    .select("id, studio_id, question, answer, sort_order, created_at")
    .single();
  if (updateError || !row) return NextResponse.json({ error: updateError?.message ?? "update_failed" }, { status: 500 });

  revalidatePath("/dashboard/settings/faqs");
  revalidatePath("/dashboard/settings");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
  return NextResponse.json({ ok: true, row });
}

export async function DELETE(_req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: existing, error } = await admin
    .from("studio_faqs")
    .select("id, studio_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: studio } = await admin
    .from("studios")
    .select("id, public_slug")
    .eq("id", existing.studio_id)
    .maybeSingle();
  if (!studio) return NextResponse.json({ error: "studio_not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: existing.studio_id,
    roles: ["owner"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const { error: deleteError } = await admin.from("studio_faqs").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  revalidatePath("/dashboard/settings/faqs");
  revalidatePath("/dashboard/settings");
  if (studio.public_slug) revalidatePath(`/${studio.public_slug}`);
  return NextResponse.json({ ok: true });
}

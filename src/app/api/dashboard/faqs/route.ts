import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateDashboardSettings, revalidatePublicStudioPath } from "@/lib/revalidatePublic";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  studio_id: z.string().uuid(),
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(6000),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, public_slug")
    .eq("id", parsed.data.studio_id)
    .maybeSingle();
  if (!studio) return NextResponse.json({ error: "studio_not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: parsed.data.studio_id,
    roles: ["owner"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const { data: row, error } = await admin
    .from("studio_faqs")
    .insert({
      studio_id: parsed.data.studio_id,
      question: parsed.data.question,
      answer: parsed.data.answer,
      sort_order: parsed.data.sort_order ?? 100,
    })
    .select("id, studio_id, question, answer, sort_order, created_at")
    .single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "create_failed" }, { status: 500 });

  revalidateDashboardSettings("faqs");
  if (studio.public_slug) revalidatePublicStudioPath(studio.public_slug);
  return NextResponse.json({ ok: true, row });
}

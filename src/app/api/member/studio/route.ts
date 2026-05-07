import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertMemberStudioMembership } from "@/lib/member-studio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  slug: z.string().min(3).max(60),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = normalizeStudioSlug(parsed.data.slug);
  if (!slug) return NextResponse.json({ error: "invalid_slug" }, { status: 400 });

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!studio?.id) return NextResponse.json({ error: "studio_not_found" }, { status: 404 });

  await upsertMemberStudioMembership(admin, { userId: user.id, studioId: studio.id });
  return NextResponse.json({ ok: true });
}

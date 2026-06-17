import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordStudioContentUpdate } from "@/lib/pwaUpdates";
import { revalidateDashboardContent, revalidatePublicSectionPaths } from "@/lib/revalidatePublic";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("packages")
    .select("id, studio_id, location_id, share_slug")
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

  const { error: uErr } = await admin.from("packages").update({ is_active: true, deleted_at: null }).eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  const { data: studio } = await admin.from("studios").select("public_slug").eq("id", row.studio_id).maybeSingle();
  revalidateDashboardContent("packages");
  if (studio?.public_slug) revalidatePublicSectionPaths(studio.public_slug, "packages", row.share_slug ?? null);
  await recordStudioContentUpdate(row.studio_id, "packages");
  return NextResponse.json({ ok: true });
}

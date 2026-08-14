import { NextResponse } from "next/server";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function asPositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: true, overdueCount: 0, backlogHours: 24 });
  }

  const url = new URL(req.url);
  const studioIdInput = url.searchParams.get("studio_id");
  const locationIdInput = url.searchParams.get("location_id");
  const backlogHours = Math.min(24 * 30, asPositiveInt(url.searchParams.get("backlog_hours"), 24));

  const { studioIds, selectedStudioId, selectedLocationId } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email ?? null,
      studioId: studioIdInput,
      locationId: locationIdInput,
    },
    ["owner", "manager", "frontdesk"],
  );

  if (studioIds.length === 0) {
    return NextResponse.json({ ok: true, overdueCount: 0, backlogHours });
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const cutoffIso = new Date(Date.now() - backlogHours * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  let query = admin
    .from("pkg02_adjustment_requests")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", activeStudioId)
    .eq("status", "approved")
    .lte("approved_at", cutoffIso);

  if (selectedLocationId) {
    query = query.eq("location_id", selectedLocationId);
  }

  const { count } = await query;

  return NextResponse.json({
    ok: true,
    overdueCount: count ?? 0,
    backlogHours,
    studioId: activeStudioId,
    locationId: selectedLocationId ?? null,
  });
}


import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffScope } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  q: z.string().min(1).max(120),
  studio_id: z.string().uuid(),
  location_id: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    studio_id: url.searchParams.get("studio_id") ?? "",
    location_id: url.searchParams.get("location_id") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId: parsed.data.studio_id,
    locationId: parsed.data.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = createAdminClient();
  let q = admin
    .from("bookings")
    .select(
      `
      id,
      status,
      guest_name,
      guest_email,
      guest_phone,
      users ( email ),
      class_sessions!inner ( start_time, location_id, classes!inner ( studio_id, title ) )
    `,
    )
    .in("class_sessions.classes.studio_id", [parsed.data.studio_id])
    .or(
      `guest_name.ilike.%${parsed.data.q}%,guest_email.ilike.%${parsed.data.q}%,guest_phone.ilike.%${parsed.data.q}%,users.email.ilike.%${parsed.data.q}%`,
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (parsed.data.location_id) q = q.eq("class_sessions.location_id", parsed.data.location_id);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

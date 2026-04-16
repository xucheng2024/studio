import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  client_package_id: z.string().uuid(),
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

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_package_booking", {
    p_session_id: parsed.data.session_id,
    p_client_id: user.id,
    p_client_package_id: parsed.data.client_package_id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const r = data as { ok?: boolean; error?: string; booking_id?: string };
  if (!r?.ok) return NextResponse.json({ error: r?.error ?? "package_booking_failed" }, { status: 409 });
  return NextResponse.json({ ok: true, booking_id: r.booking_id });
}

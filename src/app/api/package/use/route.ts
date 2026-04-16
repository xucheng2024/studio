import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  client_package_id: z.string().uuid(),
  credits: z.number().int().positive().max(50).default(1),
});

/** Manual deduction (e.g. owner adjustment). Booking flow uses DB RPC instead. */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("client_packages")
    .select("id, client_id, credits_left")
    .eq("id", parsed.data.client_package_id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (row.client_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const nextCredits = row.credits_left - parsed.data.credits;
  if (nextCredits < 0) {
    return NextResponse.json({ error: "insufficient_credits" }, { status: 409 });
  }

  const { error: updErr } = await admin
    .from("client_packages")
    .update({ credits_left: nextCredits })
    .eq("id", row.id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ credits_left: nextCredits });
}

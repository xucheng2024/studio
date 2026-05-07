import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  full_name: z.string().max(120).optional().nullable(),
  phone: z.string().max(40),
});

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

  const full_name = parsed.data.full_name?.trim() || null;
  const phone = parsed.data.phone.trim();
  if (!phone) {
    return NextResponse.json({ error: "phone_required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_profiles")
    .upsert(
      {
        id: user.id,
        email: user.email ?? null,
        full_name,
        phone,
      },
      { onConflict: "id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

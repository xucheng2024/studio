import { NextResponse } from "next/server";
import { z } from "zod";
import { findClientIdByEmail } from "@/lib/resolveClientId";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  email: z.string().email().max(320),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const id = await findClientIdByEmail(admin, parsed.data.email);
  return NextResponse.json({ exists: Boolean(id) });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const BodySchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("pwa_push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint);

  if (error) return NextResponse.json({ error: "unsubscribe_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

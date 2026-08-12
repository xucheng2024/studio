import { NextResponse } from "next/server";
import { z } from "zod";
import { lockPosSale } from "@/lib/pos-sales";
import { createClient } from "@/lib/supabase/server";
import { posErrorResponse } from "../../_shared";

const bodySchema = z.object({
  studio_id: z.string().uuid(),
  sale_id: z.string().uuid(),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await lockPosSale({
    userId: user.id,
    studioId: parsed.data.studio_id,
    saleId: parsed.data.sale_id,
    idempotencyKey: parsed.data.idempotency_key ?? null,
  });

  if (!result.ok) {
    return posErrorResponse(result);
  }

  return NextResponse.json({ ok: true, ...result.payload });
}


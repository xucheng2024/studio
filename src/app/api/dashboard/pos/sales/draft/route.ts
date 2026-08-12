import { NextResponse } from "next/server";
import { z } from "zod";
import { createPosSaleDraft } from "@/lib/pos-sales";
import { createClient } from "@/lib/supabase/server";
import { posErrorResponse } from "../../_shared";

const bodySchema = z.object({
  studio_id: z.string().uuid(),
  location_id: z.string().uuid(),
  salon_customer_id: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
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

  const result = await createPosSaleDraft({
    userId: user.id,
    studioId: parsed.data.studio_id,
    locationId: parsed.data.location_id,
    salonCustomerId: parsed.data.salon_customer_id ?? null,
    note: parsed.data.note ?? null,
    idempotencyKey: parsed.data.idempotency_key ?? null,
  });

  if (!result.ok) {
    return posErrorResponse(result);
  }

  return NextResponse.json({ ok: true, ...result.payload });
}


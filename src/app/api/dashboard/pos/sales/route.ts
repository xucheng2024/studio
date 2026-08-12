import { NextResponse } from "next/server";
import { z } from "zod";
import { listPosSalesForDashboard } from "@/lib/pos-sales-read";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  studio_id: z.string().uuid(),
  location_id: z.string().uuid().optional(),
  status: z.enum(["draft", "pending_payment", "paid", "partially_refunded", "refunded", "voided"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function toStatus(code: "forbidden" | "invalid_request" | "not_found") {
  switch (code) {
    case "invalid_request":
      return 400;
    case "not_found":
      return 404;
    default:
      return 403;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    studio_id: url.searchParams.get("studio_id") ?? "",
    location_id: url.searchParams.get("location_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_query" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await listPosSalesForDashboard({
    userId: user.id,
    email: user.email ?? null,
    studioId: parsed.data.studio_id,
    locationId: parsed.data.location_id ?? null,
    status: parsed.data.status,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.code, message: result.message },
      { status: toStatus(result.code) },
    );
  }

  return NextResponse.json({
    ok: true,
    role: result.role,
    total_count: result.totalCount,
    sales: result.sales,
  });
}


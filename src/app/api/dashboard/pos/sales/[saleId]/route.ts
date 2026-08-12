import { NextResponse } from "next/server";
import { z } from "zod";
import { getPosSaleDetailForDashboard } from "@/lib/pos-sales-read";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  studio_id: z.string().uuid(),
  location_id: z.string().uuid().optional(),
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ saleId: string }> },
) {
  const { saleId } = await params;
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    studio_id: url.searchParams.get("studio_id") ?? "",
    location_id: url.searchParams.get("location_id") ?? undefined,
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

  const result = await getPosSaleDetailForDashboard({
    userId: user.id,
    email: user.email ?? null,
    studioId: parsed.data.studio_id,
    saleId,
    locationId: parsed.data.location_id ?? null,
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
    detail: result.detail,
  });
}


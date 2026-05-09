import { NextResponse } from "next/server";
import { z } from "zod";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** @deprecated Prefer POST /api/book/member (auto FEFO). This route remains for manual package override. */

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
  await sweepExpiredPendingPayments(admin);
  const { data: sessionRow } = await admin
    .from("class_sessions")
    .select("id, status, classes!inner(studio_id)")
    .eq("id", parsed.data.session_id)
    .maybeSingle();

  if (!sessionRow) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if ((sessionRow.status ?? "scheduled") !== "scheduled") {
    return NextResponse.json({ error: "session_not_available" }, { status: 409 });
  }

  const cls = sessionRow.classes as { studio_id?: string } | { studio_id?: string }[] | null;
  const pkgStudioId = Array.isArray(cls) ? cls[0]?.studio_id : cls?.studio_id;
  if (pkgStudioId) {
    const { data: st } = await admin.from("studios").select("contract_status").eq("id", pkgStudioId).maybeSingle();
    if (st?.contract_status === "suspended") {
      return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
    }
  }

  const { data, error } = await admin.rpc("create_package_booking", {
    p_session_id: parsed.data.session_id,
    p_client_id: user.id,
    p_client_package_id: parsed.data.client_package_id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const r = data as { ok?: boolean; error?: string; booking_id?: string; credits_required?: number };
  if (!r?.ok) return NextResponse.json({ error: r?.error ?? "package_booking_failed" }, { status: 409 });
  return NextResponse.json(
    { ok: true, booking_id: r.booking_id, credits_required: r.credits_required },
    {
      headers: {
        Deprecation: "true",
        Link: '</api/book/member>; rel="successor-version"',
      },
    },
  );
}

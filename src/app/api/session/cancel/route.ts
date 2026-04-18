import { NextResponse } from "next/server";
import { z } from "zod";
import { sendSessionCancelledNotice } from "@/lib/email";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

type RpcResult = {
  ok?: boolean;
  error?: string;
  idempotent?: boolean;
  session_id?: string;
  affected_bookings?: number;
  credits_returned_count?: number;
  payments_refunded_count?: number;
  already_cancelled_count?: number;
  errors_count?: number;
};

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
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: sessionRow, error: sErr } = await admin
    .from("class_sessions")
    .select(
      `
      id,
      status,
      start_time,
      location_id,
      classes!inner ( id, title, studio_id ),
      locations ( id, name )
    `,
    )
    .eq("id", parsed.data.session_id)
    .maybeSingle();

  if (sErr || !sessionRow) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const cls = sessionRow.classes as { studio_id?: string; title?: string } | { studio_id?: string; title?: string }[] | null;
  const c0 = Array.isArray(cls) ? cls[0] : cls;
  const studioId = c0?.studio_id;
  if (!studioId) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const loc = sessionRow.locations as { name?: string | null } | { name?: string | null }[] | null;
  const locationName = Array.isArray(loc) ? loc[0]?.name : loc?.name;

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId,
    locationId: sessionRow.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) {
    return staffScopeFailureResponse(scoped);
  }

  const { data: rpcData, error: rpcErr } = await admin.rpc("cancel_session_with_settlement", {
    p_session_id: parsed.data.session_id,
    p_actor_id: user.id,
    p_reason: parsed.data.reason?.trim() || null,
  });

  if (rpcErr) {
    const raw = rpcErr.message ?? "cancel_failed";
    const m = /refund_failed payment\s+([0-9a-fA-F-]{8,}):\s*(.+)$/i.exec(raw);
    if (m) {
      return NextResponse.json(
        {
          error: "refund_failed",
          message: `A refund failed for payment ${m[1]}. Details: ${m[2]}. No changes were applied.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "rpc_error", message: raw }, { status: 500 });
  }

  const r = rpcData as RpcResult;
  if (!r?.ok) {
    if (r?.error === "session_not_found") {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    if (r?.error === "session_not_cancellable") {
      return NextResponse.json({ error: "session_not_cancellable", session_status: (r as { session_status?: string }).session_status }, { status: 409 });
    }
    return NextResponse.json({ error: r?.error ?? "cancel_failed" }, { status: 409 });
  }

  const idempotent = r.idempotent === true;
  const summary = {
    affected_bookings: r.affected_bookings ?? 0,
    credits_returned_count: r.credits_returned_count ?? 0,
    payments_refunded_count: r.payments_refunded_count ?? 0,
    already_cancelled_count: r.already_cancelled_count ?? 0,
    errors_count: r.errors_count ?? 0,
    idempotent,
  };

  if (!idempotent) {
    const title = c0?.title ?? "Class";
    const startStr = sessionRow.start_time
      ? new Date(sessionRow.start_time as string).toLocaleString()
      : "";
    const { data: bookingRows } = await admin
      .from("bookings")
      .select("guest_email, guest_name, client_id, users ( email )")
      .eq("session_id", parsed.data.session_id)
      .eq("status", "cancelled_by_studio");

    const sent = new Set<string>();
    for (const b of bookingRows ?? []) {
      const u = b.users as { email?: string | null } | { email?: string | null }[] | null;
      const emailFromUser = Array.isArray(u) ? u[0]?.email : u?.email;
      const to = emailFromUser ?? b.guest_email ?? null;
      if (!to || sent.has(to.toLowerCase())) continue;
      sent.add(to.toLowerCase());
      await sendSessionCancelledNotice({
        to: to,
        sessionTitle: title,
        startTime: startStr,
        locationName: locationName ?? null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    already_cancelled: idempotent,
    ...summary,
  });
}

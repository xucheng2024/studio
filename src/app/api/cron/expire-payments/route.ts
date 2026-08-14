import { NextResponse } from "next/server";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Vercel Cron: expire stale pending payments (releases held seats).
 * Set CRON_SECRET in Vercel; cron requests send Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const expired = await sweepExpiredPendingPayments(admin);
  const { data: expiredAppointmentsData } = await admin.rpc("expire_pending_salon_appointments", {
    p_limit: 500,
  });
  const expiredAppointments = Number(expiredAppointmentsData ?? 0);
  return NextResponse.json({
    ok: true,
    expiredPayments: expired,
    expiredAppointments: Number.isFinite(expiredAppointments) ? expiredAppointments : 0,
  });
}

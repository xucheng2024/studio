import { NextResponse } from "next/server";
import { notifyCronFailure } from "@/lib/cronAlert";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  // Require the secret to be configured – absence of CRON_SECRET is not a free pass
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("expire_pending_payments");
  if (error) {
    await notifyCronFailure({ job: "payment_expire", error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, expired: data ?? 0 });
}

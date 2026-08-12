import { NextResponse } from "next/server";
import { processAppointmentEmailNotificationBatch } from "@/lib/appointment-notifications";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const batchSizeRaw = Number(url.searchParams.get("batch_size") ?? "30");
  const batchSize = Number.isFinite(batchSizeRaw) ? Math.max(1, Math.min(100, Math.trunc(batchSizeRaw))) : 30;

  const result = await processAppointmentEmailNotificationBatch({
    batchSize,
    workerId: "vercel-cron:apt05-email",
  });

  return NextResponse.json({ ok: true, ...result });
}

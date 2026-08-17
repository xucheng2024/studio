import { NextResponse } from "next/server";
import { processMarketingCampaignBatch } from "@/lib/marketing-dispatch";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const requested = Number(new URL(request.url).searchParams.get("batch_size") ?? "50");
  const batchSize = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.trunc(requested))) : 50;
  const result = await processMarketingCampaignBatch(batchSize);
  return NextResponse.json({ ok: true, ...result });
}

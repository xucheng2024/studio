import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "studio_webhook_required" }, { status: 410 });
}

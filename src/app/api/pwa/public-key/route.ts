import { NextResponse } from "next/server";
import { getWebPushPublicKey } from "@/lib/webPush";

export async function GET() {
  return NextResponse.json({ publicKey: getWebPushPublicKey() });
}

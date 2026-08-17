import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (token && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    await createAdminClient().rpc("mkt01_unsubscribe_recipient", { p_token: token });
  }
  return new NextResponse("<!doctype html><title>Email preferences</title><main><h1>Email preferences updated</h1><p>You will no longer receive marketing email from this studio.</p></main>", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  client_package_id: z.string().uuid(),
  credits: z.number().int().positive().max(50).default(1),
});

/** Manual deduction (e.g. owner adjustment). Booking flow uses DB RPC instead. */
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
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("client_packages")
    .select("id, client_id, credits_left, packages!inner(studio_id)")
    .eq("id", parsed.data.client_package_id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (row.client_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const pkg = row.packages as { studio_id?: string } | { studio_id?: string }[] | null;
  const useStudioId = Array.isArray(pkg) ? pkg[0]?.studio_id : pkg?.studio_id;
  if (useStudioId) {
    const blockedUse = await respondIfStudioContractSuspended(admin, useStudioId);
    if (blockedUse) return blockedUse;
  }

  const nextCredits = row.credits_left - parsed.data.credits;
  if (nextCredits < 0) {
    return NextResponse.json({ error: "insufficient_credits" }, { status: 409 });
  }

  // Optimistic lock: only update if credits_left is still the value we read.
  // Concurrent requests that also read the same value will match 0 rows and
  // be detected as a conflict, preventing double-spend.
  const { data: updated, error: updErr } = await admin
    .from("client_packages")
    .update({ credits_left: nextCredits })
    .eq("id", row.id)
    .eq("credits_left", row.credits_left)
    .select("credits_left");

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  if (!updated?.length) {
    return NextResponse.json({ error: "concurrent_modification" }, { status: 409 });
  }

  return NextResponse.json({ credits_left: nextCredits });
}

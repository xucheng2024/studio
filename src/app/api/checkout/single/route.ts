import { NextResponse } from "next/server";
import { z } from "zod";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  session_id: z.string().uuid(),
});

/** Mock single-class purchase: grants one `single` payment credit (Stripe later). */
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
  const { data: session, error: sErr } = await admin
    .from("class_sessions")
    .select(
      `
      id,
      guest_price,
      classes ( studio_id )
    `,
    )
    .eq("id", parsed.data.session_id)
    .single();

  if (sErr || !session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const cls = session.classes as { studio_id: string } | { studio_id: string }[] | null;
  const studioId = Array.isArray(cls) ? cls[0]?.studio_id : cls?.studio_id;
  if (!studioId) {
    return NextResponse.json({ error: "invalid_session" }, { status: 500 });
  }

  const blockedCheckout = await respondIfStudioContractSuspended(admin, studioId);
  if (blockedCheckout) return blockedCheckout;

  const amount = Number(session.guest_price ?? 0);

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      studio_id: studioId,
      client_id: user.id,
      amount,
      type: "single",
      status: "paid",
      remaining_uses: 1,
    })
    .select("id, amount")
    .single();

  if (pErr || !payment) {
    return NextResponse.json({ error: pErr?.message ?? "payment_failed" }, { status: 500 });
  }

  return NextResponse.json({
    payment_id: payment.id,
    amount: payment.amount,
    checkout: "mock",
  });
}

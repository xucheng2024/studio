import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPaymentSubmittedNotice } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  note: z.string().max(300).optional(),
  reference_code: z.string().max(120).optional(),
});

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
  const { data: payment, error: pErr } = await admin
    .from("payments")
    .select("id, client_id, status, customer_confirmed_at, reference_code, studio_id, amount")
    .eq("id", parsed.data.payment_id)
    .single();
  if (pErr || !payment) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });

  const isClientOwner = payment.client_id != null && payment.client_id === user.id;
  const inputRef = parsed.data.reference_code?.trim() ?? "";
  const paymentRef = payment.reference_code?.trim() ?? "";
  const isGuestPayment = payment.client_id == null;
  const canConfirmGuestPayment = isGuestPayment && inputRef.length > 0 && inputRef === paymentRef;
  if (!isClientOwner && !canConfirmGuestPayment) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (payment.status !== "pending") {
    return NextResponse.json({ error: "not_pending" }, { status: 409 });
  }
  if (payment.customer_confirmed_at) {
    return NextResponse.json({ ok: true, already_confirmed: true });
  }

  const note = parsed.data.note?.trim() || null;
  const { error } = await admin
    .from("payments")
    .update({
      customer_confirmed_at: new Date().toISOString(),
      customer_confirmation_note: note,
    })
    .eq("id", parsed.data.payment_id)
    .eq("status", "pending");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (payment.studio_id) {
    const recipients = new Set<string>();
    const { data: studio } = await admin.from("studios").select("owner_id").eq("id", payment.studio_id).maybeSingle();
    if (studio?.owner_id) {
      const { data: owner } = await admin.from("users").select("email").eq("id", studio.owner_id).maybeSingle();
      if (owner?.email) recipients.add(owner.email);
    }
    const { data: staff } = await admin
      .from("staff_memberships")
      .select("user_id")
      .eq("studio_id", payment.studio_id)
      .eq("is_active", true)
      .in("role", ["owner", "manager", "frontdesk"]);
    const ids = [...new Set((staff ?? []).map((s) => s.user_id))];
    if (ids.length) {
      const { data: users } = await admin.from("users").select("email").in("id", ids);
      for (const u of users ?? []) {
        if (u.email) recipients.add(u.email);
      }
    }
    if (recipients.size > 0) {
      await sendPaymentSubmittedNotice({
        to: [...recipients],
        amount: Number(payment.amount ?? 0),
        reference: payment.reference_code ?? null,
      });
    }
  }

  return NextResponse.json({ ok: true, submitted: true });
}

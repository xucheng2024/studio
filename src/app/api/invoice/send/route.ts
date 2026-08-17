import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPaymentInvoice } from "@/lib/invoice-service";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeOperationAudit } from "@/lib/audit";

const schema = z.object({
  payment_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: payment, error } = await admin
    .from("payments")
    .select("id, studio_id, location_id, status, invoice_status")
    .eq("id", parsed.data.payment_id)
    .single();
  if (error || !payment) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  if (payment.status !== "paid") return NextResponse.json({ error: "invoice_requires_paid_status" }, { status: 409 });
  if (payment.invoice_status === "void") {
    return NextResponse.json({ error: "invoice_voided" }, { status: 409 });
  }
  if (!payment.studio_id) return NextResponse.json({ error: "invalid_payment_scope" }, { status: 409 });

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId: payment.studio_id,
    locationId: payment.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  try {
    const result = await sendPaymentInvoice(parsed.data.payment_id);
    await writeOperationAudit({
      actorId: user.id,
      actorRole: scoped.role,
      action: "invoice_send",
      targetType: "payment",
      targetId: parsed.data.payment_id,
      afterState: { invoice_number: result.invoiceNumber, recipient: result.toEmail },
    });
    return NextResponse.json({ ok: true, invoice_number: result.invoiceNumber, recipient: result.toEmail });
  } catch (e) {
    const code = e instanceof Error ? e.message : "invoice_send_failed";
    if (code === "payment_not_found") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    if (code === "invoice_requires_paid_status" || code === "invoice_missing_studio" || code === "invoice_voided") {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    if (code === "invoice_recipient_not_found") {
      return NextResponse.json({ error: code }, { status: 422 });
    }
    if (code === "invoice_email_not_configured") {
      return NextResponse.json(
        { error: code, error_detail: "This studio has not enabled its own Resend account." },
        { status: 503 },
      );
    }
    if (code.startsWith("invoice_send_failed")) {
      return NextResponse.json({ error: "invoice_send_failed" }, { status: 502 });
    }
    return NextResponse.json({ error: code }, { status: 500 });
  }
}

import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { loadInvoicePayment, resolveInvoicePayload } from "@/lib/invoice-payment";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ paymentId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { paymentId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { payment, error } = await loadInvoicePayment(paymentId);

  if (error || !payment) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  if (payment.invoice_status === "void") return NextResponse.json({ error: "invoice_voided" }, { status: 409 });
  if (!payment.studio_id) return NextResponse.json({ error: "invalid_payment_scope" }, { status: 409 });

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId: payment.studio_id,
    locationId: payment.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const payload = await resolveInvoicePayload(admin, payment, {
    assignInvoiceNumberForPaid: false,
  });
  const pdfBuffer = await renderInvoicePdf(payload);

  return new Response(Buffer.from(pdfBuffer) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice_${payload.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

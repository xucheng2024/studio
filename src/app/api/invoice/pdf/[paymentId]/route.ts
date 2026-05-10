import { renderInvoicePdf } from "@/lib/invoice-pdf";
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

  const { data: payment, error } = await admin
    .from("payments")
    .select(
      `id, studio_id, location_id, client_id, booking_id, status, type,
       amount, currency, reference_code, guest_name, guest_email,
       created_at, verified_at, invoice_number, invoice_status,
       studios ( name )`,
    )
    .eq("id", paymentId)
    .single();

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

  // Resolve invoice number (may not yet be assigned for unpaid payments)
  let invoiceNumber = payment.invoice_number;
  if (!invoiceNumber) {
    const { data: assigned } = await admin.rpc("assign_payment_invoice_number", {
      p_payment_id: paymentId,
    });
    invoiceNumber = assigned ? String(assigned) : `DRAFT-${paymentId.slice(0, 8).toUpperCase()}`;
  }

  // Resolve customer info
  let customerName = "Member";
  let customerEmail: string | null = payment.guest_email ?? null;
  if (payment.guest_name) customerName = payment.guest_name;
  if (payment.client_id) {
    const { data: u } = await admin.from("users").select("email").eq("id", payment.client_id).maybeSingle();
    if (u?.email) { customerName = u.email; customerEmail = u.email; }
  }
  if (payment.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("guest_name, guest_email, class_sessions ( classes ( title ) )")
      .eq("id", payment.booking_id)
      .maybeSingle();
    if (booking?.guest_name) customerName = booking.guest_name;
    if (booking?.guest_email) customerEmail = booking.guest_email;
  }

  // Resolve line item
  let lineItem = payment.type === "package" ? "Package purchase" : "Class booking";
  if (payment.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("class_sessions ( classes ( title ) )")
      .eq("id", payment.booking_id)
      .maybeSingle();
    const session = Array.isArray(booking?.class_sessions) ? booking.class_sessions[0] : booking?.class_sessions;
    const cls = Array.isArray(session?.classes) ? session.classes[0] : session?.classes;
    if (cls?.title) lineItem = `Class: ${cls.title}`;
  }

  function toDateLabel(v: string | null | undefined) {
    const d = v ? new Date(v) : new Date();
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  }

  const studioName =
    (Array.isArray(payment.studios) ? payment.studios[0] : payment.studios)?.name ?? "Studio";

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber,
    studioName,
    customerName,
    customerEmail,
    currency: payment.currency ?? "SGD",
    amount: Number(payment.amount ?? 0),
    issueDate: toDateLabel(payment.verified_at ?? payment.created_at),
    referenceCode: payment.reference_code ?? null,
    lineItem,
  });

  return new Response(Buffer.from(pdfBuffer) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice_${invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

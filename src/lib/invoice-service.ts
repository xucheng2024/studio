import { sendInvoiceNotice } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { createAdminClient } from "@/lib/supabase/admin";

function toISODateLabel(value: string | null | undefined) {
  const d = value ? new Date(value) : new Date();
  const day = String(d.getUTCDate()).padStart(2, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const y = d.getUTCFullYear();
  return `${day}/${m}/${y}`;
}

export async function sendPaymentInvoice(paymentId: string) {
  const admin = createAdminClient();
  const { data: payment, error } = await admin
    .from("payments")
    .select(
      `
      id,
      studio_id,
      client_id,
      booking_id,
      amount,
      currency,
      status,
      type,
      reference_code,
      guest_name,
      guest_email,
      created_at,
      verified_at,
      invoice_number,
      invoice_status,
      studios ( name )
    `,
    )
    .eq("id", paymentId)
    .single();
  if (error || !payment) throw new Error("payment_not_found");
  if (payment.status !== "paid") throw new Error("invoice_requires_paid_status");
  if (payment.invoice_status === "void") {
    throw new Error("invoice_voided");
  }
  if (!payment.studio_id) throw new Error("invoice_missing_studio");

  /** Primary assignment happens in /api/payment/mark; this is fallback for legacy rows or edge cases. */
  let invoiceNumber = payment.invoice_number;
  if (!invoiceNumber) {
    const { data: assigned, error: assignError } = await admin.rpc("assign_payment_invoice_number", {
      p_payment_id: paymentId,
    });
    if (assignError || assigned == null || String(assigned).trim() === "") {
      throw new Error(assignError?.message ?? "invoice_assign_failed");
    }
    invoiceNumber = String(assigned);
  }

  let customerName = "Member";
  let toEmail: string | null = null;
  let lineItem = payment.type === "package" ? "Package purchase" : "Class booking";
  if (payment.guest_name) customerName = payment.guest_name;
  if (payment.guest_email) toEmail = payment.guest_email;
  if (payment.client_id) {
    const { data: u } = await admin.from("users").select("email").eq("id", payment.client_id).maybeSingle();
    if (u?.email) {
      customerName = u.email;
      toEmail = u.email;
    }
  }
  if (payment.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("guest_name, guest_email, class_sessions ( classes ( title ) )")
      .eq("id", payment.booking_id)
      .maybeSingle();
    if (booking?.guest_name) customerName = booking.guest_name;
    if (booking?.guest_email) toEmail = booking.guest_email;
    const session = Array.isArray(booking?.class_sessions) ? booking.class_sessions[0] : booking?.class_sessions;
    const cls = Array.isArray(session?.classes) ? session.classes[0] : session?.classes;
    if (cls?.title) lineItem = `Class: ${cls.title}`;
  }

  if (!toEmail) {
    throw new Error("invoice_recipient_not_found");
  }

  const payload = {
    invoiceNumber,
    studioName: (Array.isArray(payment.studios) ? payment.studios[0] : payment.studios)?.name ?? "Studio",
    customerName,
    customerEmail: toEmail,
    currency: payment.currency ?? "SGD",
    amount: Number(payment.amount ?? 0),
    issueDate: toISODateLabel(payment.verified_at ?? payment.created_at),
    referenceCode: payment.reference_code ?? null,
    lineItem,
  };
  const pdfBuffer = await renderInvoicePdf(payload);
  const mailResult = await sendInvoiceNotice({
    to: toEmail,
    studioName: payload.studioName,
    invoiceNumber: payload.invoiceNumber,
    customerName: payload.customerName,
    currency: payload.currency,
    amount: payload.amount,
    issueDate: payload.issueDate,
    lineItem: payload.lineItem,
    referenceCode: payload.referenceCode,
    pdfBase64: Buffer.from(pdfBuffer).toString("base64"),
  });
  if (mailResult.skipped) {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      throw new Error("invoice_email_not_configured");
    }
    throw new Error(mailResult.error ? `invoice_send_failed:${mailResult.error}` : "invoice_send_failed");
  }

  await admin.from("payments").update({ invoice_sent_at: new Date().toISOString() }).eq("id", paymentId);

  return { invoiceNumber, toEmail };
}

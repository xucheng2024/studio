import { sendInvoiceNotice } from "@/lib/email";
import { loadInvoicePayment, resolveInvoicePayload } from "@/lib/invoice-payment";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

export async function sendPaymentInvoice(paymentId: string) {
  const { admin, payment, error } = await loadInvoicePayment(paymentId);
  if (error || !payment) throw new Error("payment_not_found");
  if (payment.status !== "paid") throw new Error("invoice_requires_paid_status");
  if (payment.invoice_status === "void") {
    throw new Error("invoice_voided");
  }
  if (!payment.studio_id) throw new Error("invoice_missing_studio");

  const payload = await resolveInvoicePayload(admin, payment, { assignInvoiceNumberForPaid: true });
  const toEmail = payload.customerEmail;
  if (!toEmail) {
    throw new Error("invoice_recipient_not_found");
  }
  const pdfBuffer = await renderInvoicePdf(payload);
  const mailResult = await sendInvoiceNotice({
    studioId: payment.studio_id,
    to: toEmail,
    studioName: payload.studioName,
    studioEmail: payload.studioEmail,
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
    if (mailResult.error === "email_provider_not_configured") {
      throw new Error("invoice_email_not_configured");
    }
    throw new Error(mailResult.error ? `invoice_send_failed:${mailResult.error}` : "invoice_send_failed");
  }

  await admin.from("payments").update({ invoice_sent_at: new Date().toISOString() }).eq("id", paymentId);

  return { invoiceNumber: payload.invoiceNumber, toEmail };
}

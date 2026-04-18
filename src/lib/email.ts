import { Resend } from "resend";

async function sendEmail(params: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    type: string;
    encoding: "base64";
  }>;
}) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return { skipped: true as const };
  const resend = new Resend(key);
  await resend.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: params.attachments,
  });
  return { skipped: false as const };
}

export async function sendBookingConfirmation(params: {
  to: string;
  sessionTitle: string;
  startTime: string;
}) {
  return sendEmail({
    to: params.to,
    subject: `Booking confirmed: ${params.sessionTitle}`,
    text: `You are booked for ${params.sessionTitle} at ${params.startTime}.`,
  });
}

export async function sendPaymentSubmittedNotice(params: {
  to: string | string[];
  amount: number;
  reference: string | null;
}) {
  return sendEmail({
    to: params.to,
    subject: "Payment submitted for verification",
    text: `Customer submitted payment notice.\nAmount: ${params.amount.toFixed(
      2,
    )}\nReference: ${params.reference ?? "-"}`,
  });
}

export async function sendPaymentResultNotice(params: {
  to: string;
  status: "paid" | "failed" | "expired" | "refunded";
  reference: string | null;
}) {
  return sendEmail({
    to: params.to,
    subject: `Payment ${params.status}`,
    text: `Your payment is marked as ${params.status}.\nReference: ${params.reference ?? "-"}`,
  });
}

export async function sendClassReminder(params: {
  to: string;
  sessionTitle: string;
  startTime: string;
}) {
  return sendEmail({
    to: params.to,
    subject: `Class reminder: ${params.sessionTitle}`,
    text: `Reminder: ${params.sessionTitle} starts at ${params.startTime}.`,
  });
}

export async function sendSessionCancelledNotice(params: {
  to: string;
  sessionTitle: string;
  startTime: string;
  locationName: string | null;
}) {
  const lines = [
    "Your class has been cancelled by the studio.",
    "",
    `Class: ${params.sessionTitle}`,
    `Time: ${params.startTime}`,
    params.locationName ? `Location: ${params.locationName}` : null,
    "",
    "Where this applies to your booking, we have automatically processed refunds for paid fees and returned package credits if you had already checked in with a package.",
  ].filter(Boolean);
  return sendEmail({
    to: params.to,
    subject: `Class cancelled: ${params.sessionTitle}`,
    text: lines.join("\n"),
  });
}

export async function sendBookingOutcomeNotice(params: {
  to: string;
  sessionTitle: string;
  status: "late_cancel" | "no_show";
  creditReturned: boolean;
}) {
  const statusText = params.status === "late_cancel" ? "Late cancellation" : "No-show";
  const creditText = params.creditReturned ? "Credit was returned." : "Credit was deducted.";
  return sendEmail({
    to: params.to,
    subject: `${statusText} update: ${params.sessionTitle}`,
    text: `${statusText} recorded for ${params.sessionTitle}. ${creditText}`,
  });
}

export async function sendInvoiceNotice(params: {
  to: string;
  studioName: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  amount: number;
  issueDate: string;
  lineItem: string;
  referenceCode: string | null;
  pdfBase64: string;
}) {
  return sendEmail({
    to: params.to,
    subject: `${params.studioName} Invoice ${params.invoiceNumber}`,
    text: [
      `Hi ${params.customerName},`,
      "",
      `Your invoice ${params.invoiceNumber} is attached as PDF.`,
      `Issue date: ${params.issueDate}`,
      `Item: ${params.lineItem}`,
      `Total: ${params.currency} ${params.amount.toFixed(2)}`,
      `Reference: ${params.referenceCode ?? "-"}`,
    ].join("\n"),
    html: `<p>Hi ${params.customerName},</p>
<p>Your invoice <strong>${params.invoiceNumber}</strong> is attached as PDF.</p>
<p>Issue date: ${params.issueDate}<br/>Item: ${params.lineItem}<br/>Total: ${params.currency} ${params.amount.toFixed(2)}<br/>Reference: ${params.referenceCode ?? "-"}</p>`,
    attachments: [
      {
        filename: `Invoice_${params.invoiceNumber}.pdf`,
        content: params.pdfBase64,
        type: "application/pdf",
        encoding: "base64",
      },
    ],
  });
}

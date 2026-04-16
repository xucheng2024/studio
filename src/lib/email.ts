import { Resend } from "resend";

async function sendEmail(params: { to: string | string[]; subject: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return { skipped: true as const };
  const resend = new Resend(key);
  await resend.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
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

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
}): Promise<{ skipped: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return { skipped: true };
  const resend = new Resend(key);
  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });
    return { skipped: false };
  } catch (err) {
    // Email delivery failures must never break the HTTP response.
    // The database write has already succeeded at this point.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] send failed:", params.subject, msg);
    return { skipped: true, error: msg };
  }
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
    "Where this applies to your booking, we have automatically processed refunds for paid fees and returned class passes if you had already checked in with a package.",
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
  const creditText = params.creditReturned ? "Class pass was returned." : "Class pass was deducted.";
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
  const amountFormatted = `${params.currency} ${params.amount.toFixed(2)}`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08);">

        <!-- Header band -->
        <tr>
          <td style="background:#0d9488;padding:28px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">${params.studioName}</p>
            <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.5px;text-transform:uppercase;">Invoice ${params.invoiceNumber}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">

            <!-- Greeting -->
            <p style="margin:0 0 20px;font-size:15px;color:#111827;">Hi ${params.customerName},</p>
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
              Thank you for your payment. Your invoice is attached as a PDF to this email. A summary is included below for your records.
            </p>

            <!-- Summary card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;margin-bottom:24px;">
              <tr style="background:#f0fdfa;">
                <td style="padding:10px 16px;font-size:10px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.6px;border-bottom:1px solid #e5e7eb;" colspan="2">Invoice Summary</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Invoice No.</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">${params.invoiceNumber}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Issue Date</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;text-align:right;border-bottom:1px solid #e5e7eb;">${params.issueDate}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Description</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;text-align:right;border-bottom:1px solid #e5e7eb;">${params.lineItem}</td>
              </tr>
              ${params.referenceCode ? `
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Payment Ref.</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;font-family:monospace;text-align:right;border-bottom:1px solid #e5e7eb;">${params.referenceCode}</td>
              </tr>` : ""}
              <tr style="background:#0d9488;">
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#ffffff;">Total Paid</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#ffffff;text-align:right;">${amountFormatted}</td>
              </tr>
            </table>

            <!-- PDF note -->
            <p style="margin:0 0 28px;font-size:12px;color:#9ca3af;line-height:1.5;">
              The attached PDF invoice is your official receipt. Please keep it for your records.
            </p>

            <!-- Divider -->
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px;">

            <!-- Footer note -->
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              This invoice was sent by <strong style="color:#6b7280;">${params.studioName}</strong> via Studio platform.
              If you have questions about this invoice, please contact the studio directly.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return sendEmail({
    to: params.to,
    subject: `Invoice ${params.invoiceNumber} from ${params.studioName}`,
    text: [
      `Hi ${params.customerName},`,
      "",
      `Thank you for your payment. Please find your invoice attached.`,
      "",
      `Invoice No: ${params.invoiceNumber}`,
      `Issue Date: ${params.issueDate}`,
      `Item: ${params.lineItem}`,
      `Total: ${amountFormatted}`,
      params.referenceCode ? `Payment Ref: ${params.referenceCode}` : null,
      "",
      `This invoice was issued by ${params.studioName}.`,
    ].filter(Boolean).join("\n"),
    html,
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

export async function sendPurchaseConfirmation(params: {
  to: string;
  buyerName: string | null | undefined;
  studioName: string;
  itemDescription: string;
  amount: number;
  currency: string;
  referenceCode: string | null | undefined;
  orderCategory?: "general" | "shop";
  /** If this was a gift, show "Your gift has been sent to …" copy. */
  isGift?: boolean;
  giftRecipientEmail?: string | null;
  loginUrl: string;
}) {
  const nameSafe = escHtml((params.buyerName ?? "").trim());
  const greeting = nameSafe ? `Hi ${nameSafe},` : "Hi there,";
  const studioNameSafe = escHtml(params.studioName);
  const itemSafe = escHtml(params.itemDescription);
  const amountFormatted = `${params.currency} ${params.amount.toFixed(2)}`;
  const refSafe = params.referenceCode ? escHtml(params.referenceCode) : null;
  const loginUrlSafe = escHtml(params.loginUrl);
  const isGift = Boolean(params.isGift);
  const isShopOrder = params.orderCategory === "shop";
  const recipientSafe = params.giftRecipientEmail ? escHtml(params.giftRecipientEmail) : null;
  const headline = isGift ? "Gift sent!" : isShopOrder ? "Shop order confirmed" : "Payment confirmed";
  const bodyCopy = isGift && recipientSafe
    ? `Your gift (<strong style="color:#111827;">${itemSafe}</strong>) has been sent to <strong style="color:#111827;">${recipientSafe}</strong>. They'll receive a notification email shortly.`
    : isShopOrder
      ? `Your shop order for <strong style="color:#111827;">${itemSafe}</strong> is confirmed. We'll prepare shipment using the delivery address provided at checkout.`
      : `Your purchase of <strong style="color:#111827;">${itemSafe}</strong> is confirmed and ready to use.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0d9488;padding:28px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">${studioNameSafe}</p>
            <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.5px;text-transform:uppercase;">${headline}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#111827;">${greeting}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">${bodyCopy}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:24px;">
              <tr style="background:#f0fdfa;">
                <td colspan="2" style="padding:10px 16px;font-size:10px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.6px;border-bottom:1px solid #e5e7eb;">Order summary</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Item</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">${itemSafe}</td>
              </tr>
              ${refSafe ? `<tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Reference</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;font-family:monospace;text-align:right;border-bottom:1px solid #e5e7eb;">${refSafe}</td>
              </tr>` : ""}
              <tr style="background:#0d9488;">
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#ffffff;">Total Paid</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#ffffff;text-align:right;">${amountFormatted}</td>
              </tr>
            </table>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0d9488;border-radius:8px;">
                  <a href="${loginUrlSafe}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">View my account</a>
                </td>
              </tr>
            </table>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 20px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              This receipt was sent by <strong style="color:#6b7280;">${studioNameSafe}</strong>. If you have questions, please contact the studio directly.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const fromPlain = (params.buyerName ?? "").trim() || "there";
  const subjectLine = isGift
    ? `Gift sent — ${params.itemDescription}`
    : isShopOrder
      ? `Shop order confirmed — ${params.itemDescription}`
      : `Payment confirmed — ${params.itemDescription}`;
  return sendEmail({
    to: params.to,
    subject: subjectLine,
    text: [
      greeting.replace(/&[a-z#0-9]+;/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[m] ?? m)),
      "",
      isGift && params.giftRecipientEmail
        ? `Your gift (${params.itemDescription}) has been sent to ${params.giftRecipientEmail}.`
        : isShopOrder
          ? `Your shop order for ${params.itemDescription} is confirmed.`
          : `Your purchase of ${params.itemDescription} is confirmed.`,
      `Amount: ${amountFormatted}`,
      params.referenceCode ? `Reference: ${params.referenceCode}` : null,
      "",
      isShopOrder
        ? "We'll notify you once your order is fulfilled."
        : null,
      `Sign in to view your account: ${params.loginUrl}`,
    ].filter(Boolean).join("\n"),
    html,
  });
}

export async function sendRefundNotice(params: {
  to: string;
  buyerName: string | null | undefined;
  studioName: string;
  itemDescription: string;
  amount: number;
  currency: string;
  referenceCode: string | null | undefined;
  orderCategory?: "general" | "shop";
}) {
  const nameSafe = escHtml((params.buyerName ?? "").trim());
  const greeting = nameSafe ? `Hi ${nameSafe},` : "Hi there,";
  const studioNameSafe = escHtml(params.studioName);
  const itemSafe = escHtml(params.itemDescription);
  const amountFormatted = `${params.currency} ${params.amount.toFixed(2)}`;
  const refSafe = params.referenceCode ? escHtml(params.referenceCode) : null;
  const isShopOrder = params.orderCategory === "shop";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#6b7280;padding:28px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">${studioNameSafe}</p>
            <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.5px;text-transform:uppercase;">Refund processed</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#111827;">${greeting}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
              ${isShopOrder
                ? `Your shop order payment for <strong style="color:#111827;">${itemSafe}</strong> has been refunded. Please allow a few business days for the funds to appear in your account.`
                : `Your payment for <strong style="color:#111827;">${itemSafe}</strong> has been refunded. Please allow a few business days for the funds to appear in your account.`}
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:24px;">
              <tr style="background:#f3f4f6;">
                <td colspan="2" style="padding:10px 16px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;border-bottom:1px solid #e5e7eb;">Refund details</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Item</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">${itemSafe}</td>
              </tr>
              ${refSafe ? `<tr>
                <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Reference</td>
                <td style="padding:10px 16px;font-size:13px;color:#111827;font-family:monospace;text-align:right;border-bottom:1px solid #e5e7eb;">${refSafe}</td>
              </tr>` : ""}
              <tr style="background:#6b7280;">
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#ffffff;">Refund Amount</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#ffffff;text-align:right;">${amountFormatted}</td>
              </tr>
            </table>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              This refund was processed by <strong style="color:#6b7280;">${studioNameSafe}</strong>. If you have questions, please contact the studio directly.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return sendEmail({
    to: params.to,
    subject: `${isShopOrder ? "Shop order refunded" : "Refund processed"} — ${params.itemDescription}`,
    text: [
      greeting.replace(/&[a-z#0-9]+;/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[m] ?? m)),
      "",
      isShopOrder
        ? `Your shop order payment for ${params.itemDescription} has been refunded.`
        : `Your payment for ${params.itemDescription} has been refunded.`,
      `Amount: ${amountFormatted}`,
      params.referenceCode ? `Reference: ${params.referenceCode}` : null,
      "",
      "Please allow a few business days for the funds to appear in your account.",
    ].filter(Boolean).join("\n"),
    html,
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function sendGiftNotice(params: {
  to: string;
  recipientName: string | null | undefined;
  /** Guest buyer name (populated for guest checkout). */
  senderName: string | null | undefined;
  /** Logged-in buyer profile name (fallback when senderName is null). */
  senderProfileName?: string | null | undefined;
  studioName: string;
  itemDescription: string;
  giftMessage: string | null | undefined;
  loginUrl: string;
  /** "shop" for physical goods; "general" (default) for digital/account-linked gifts. */
  orderCategory?: "general" | "shop";
}) {
  const recipientNameSafe = escHtml((params.recipientName ?? "").trim());
  const greeting = recipientNameSafe ? `Hi ${recipientNameSafe},` : "Hi there,";
  const from = escHtml((params.senderName ?? params.senderProfileName ?? "").trim() || "Someone");
  const studioNameSafe = escHtml(params.studioName);
  const itemSafe = escHtml(params.itemDescription);
  const msg = escHtml((params.giftMessage ?? "").trim());
  const loginUrlSafe = escHtml(params.loginUrl);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0d9488;padding:28px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">${studioNameSafe}</p>
            <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.5px;text-transform:uppercase;">You've received a gift</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#111827;">${greeting}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
              <strong style="color:#111827;">${from}</strong> has sent you a gift from <strong style="color:#111827;">${studioNameSafe}</strong>:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border-radius:8px;border:1px solid #99f6e4;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0d9488;">${itemSafe}</p>
                </td>
              </tr>
            </table>
            ${msg ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf9;border-left:3px solid #0d9488;border-radius:4px;margin-bottom:24px;">
              <tr>
                <td style="padding:12px 16px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Message from ${from}</p>
                  <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${msg}</p>
                </td>
              </tr>
            </table>` : ""}
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
              ${params.orderCategory === "shop"
                ? "A physical item will be shipped to the address provided at checkout."
                : "Your gift has been added to your account. Sign in to access it."}
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0d9488;border-radius:8px;">
                  <a href="${loginUrlSafe}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${params.orderCategory === "shop" ? "View my orders" : "View my gift"}</a>
                </td>
              </tr>
            </table>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 20px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              This gift was sent via <strong style="color:#6b7280;">${studioNameSafe}</strong>. If you have questions, please contact the studio directly.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const fromPlain = (params.senderName ?? params.senderProfileName ?? "").trim() || "Someone";
  return sendEmail({
    to: params.to,
    subject: `You've received a gift from ${params.studioName}`,
    text: [
      greeting.replace(/&[a-z]+;/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[m] ?? m)),
      "",
      `${fromPlain} has sent you a gift from ${params.studioName}: ${params.itemDescription}`,
      (params.giftMessage ?? "").trim() ? `\nMessage: ${(params.giftMessage ?? "").trim()}` : null,
      "",
      params.orderCategory === "shop"
        ? `A physical item will be shipped to the address provided at checkout.`
        : `Your gift has been added to your account. Sign in here: ${params.loginUrl}`,
    ].filter(Boolean).join("\n"),
    html,
  });
}

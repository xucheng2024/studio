import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeApiRateLimit, getRequestIpAddress } from "@/lib/apiRateLimit";
import { site } from "@/lib/brand";

const schema = z.object({
  name: z.string().min(1).max(100),
  studioName: z.string().min(1).max(200),
  email: z.string().email().max(200),
  message: z.string().max(1000).optional(),
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(req: Request) {
  const rateLimit = await consumeApiRateLimit({
    action: "contact_form",
    scope: getRequestIpAddress(req),
    limit: 6,
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { name, studioName, email, message } = parsed.data;
  const escapedName = escapeHtml(name);
  const escapedStudioName = escapeHtml(studioName);
  const escapedEmail = escapeHtml(email);
  const escapedMessage = message ? escapeHtml(message).replace(/\n/g, "<br>") : "";

  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (key && from) {
    const { Resend } = await import("resend");
    const resend = new Resend(key);

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0d9488;padding:24px 28px;">
            <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;">New enquiry — ${escapeHtml(site.name)}</p>
            <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.75);">Someone is interested in getting started</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:20px;">
              <tr style="background:#f0fdfa;">
                <td style="padding:8px 14px;font-size:10px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.6px;border-bottom:1px solid #e5e7eb;" colspan="2">Contact details</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:12px;color:#6b7280;width:110px;border-bottom:1px solid #e5e7eb;">Name</td>
                <td style="padding:10px 14px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #e5e7eb;">${escapedName}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Studio</td>
                <td style="padding:10px 14px;font-size:13px;color:#111827;border-bottom:1px solid #e5e7eb;">${escapedStudioName}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:12px;color:#6b7280;${message ? "border-bottom:1px solid #e5e7eb;" : ""}">Email</td>
                <td style="padding:10px 14px;font-size:13px;color:#0d9488;${message ? "border-bottom:1px solid #e5e7eb;" : ""}">
                  <a href="mailto:${escapedEmail}" style="color:#0d9488;text-decoration:none;">${escapedEmail}</a>
                </td>
              </tr>
              ${message ? `
              <tr>
                <td style="padding:10px 14px;font-size:12px;color:#6b7280;vertical-align:top;">Message</td>
                <td style="padding:10px 14px;font-size:13px;color:#111827;line-height:1.6;">${escapedMessage}</td>
              </tr>` : ""}
            </table>
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              Reply directly to <strong style="color:#6b7280;">${escapedEmail}</strong> to get in touch.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await resend.emails.send({
      from,
      to: site.contactEmail,
      replyTo: email,
      subject: `New enquiry from ${name} — ${studioName}`,
      text: [
        `New enquiry received on ${site.name}`,
        "",
        `Name: ${name}`,
        `Studio: ${studioName}`,
        `Email: ${email}`,
        message ? `Message: ${message}` : null,
      ].filter(Boolean).join("\n"),
      html,
    }).catch((err: unknown) => {
      console.error("[contact] email send failed:", err);
    });
  }

  return NextResponse.json({ ok: true });
}

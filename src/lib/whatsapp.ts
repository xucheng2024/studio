/** Digits-only WhatsApp number, including country code. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/[^\d]/g, "");
  if (/^[89]\d{7}$/.test(digits)) return `65${digits}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function whatsappHref(phone: string | null | undefined, text: string): string | null {
  const digits = whatsappDigits(phone);
  if (!digits) return null;
  const body = text.trim();
  if (!body) return `https://wa.me/${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

function formatAppointmentWhen(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function appointmentWhatsappText(params: {
  customerName: string | null;
  serviceTitle: string;
  locationName: string;
  startsAt: string;
  status: string;
}): string {
  const name = params.customerName?.trim() || "there";
  const when = formatAppointmentWhen(params.startsAt);
  const service = params.serviceTitle.trim() || "appointment";
  const location = params.locationName.trim();
  const where = location ? ` at ${location}` : "";

  if (params.status === "cancelled") {
    return `Hi ${name}, your ${service} on ${when}${where} has been cancelled. Reply if you'd like to rebook.`;
  }
  if (params.status === "no_show") {
    return `Hi ${name}, we missed you for ${service} on ${when}${where}. Reply if you'd like to reschedule.`;
  }
  if (params.status === "pending") {
    return `Hi ${name}, confirming your ${service} on ${when}${where}. Reply YES to confirm.`;
  }
  return `Hi ${name}, reminder for your ${service} on ${when}${where}. See you then.`;
}

export function customerWhatsappText(name: string | null | undefined): string {
  const customer = name?.trim() || "there";
  return `Hi ${customer},`;
}

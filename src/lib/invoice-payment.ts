import { createAdminClient } from "@/lib/supabase/admin";

function toISODateLabel(value: string | null | undefined) {
  const d = value ? new Date(value) : new Date();
  const day = String(d.getUTCDate()).padStart(2, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const y = d.getUTCFullYear();
  return `${day}/${m}/${y}`;
}

export type InvoicePaymentRow = {
  id: string;
  studio_id: string | null;
  location_id?: string | null;
  client_id: string | null;
  booking_id: string | null;
  event_booking_id?: string | null;
  package_id?: string | null;
  membership_product_id?: string | null;
  customer_subscription_id?: string | null;
  member_zone_series_id?: string | null;
  member_zone_lesson_id?: string | null;
  shop_product_id?: string | null;
  service_id?: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  type: string | null;
  source: string | null;
  reference_code: string | null;
  guest_name: string | null;
  guest_email: string | null;
  created_at: string | null;
  verified_at: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  package_name_snapshot?: string | null;
  membership_name_snapshot?: string | null;
  shop_product_name_snapshot?: string | null;
  service_title_snapshot?: string | null;
  studios?: { name?: string | null; public_contact_email?: string | null } | { name?: string | null; public_contact_email?: string | null }[] | null;
};

export type ResolvedInvoicePayload = {
  invoiceNumber: string;
  studioName: string;
  studioEmail: string | null;
  customerName: string;
  customerEmail: string | null;
  currency: string;
  amount: number;
  issueDate: string;
  referenceCode: string | null;
  lineItem: string;
};

export async function loadInvoicePayment(paymentId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payments")
    .select(
      `
      id,
      studio_id,
      location_id,
      client_id,
      booking_id,
      event_booking_id,
      package_id,
      membership_product_id,
      customer_subscription_id,
      member_zone_series_id,
      member_zone_lesson_id,
      shop_product_id,
      service_id,
      amount,
      currency,
      status,
      type,
      source,
      reference_code,
      guest_name,
      guest_email,
      created_at,
      verified_at,
      invoice_number,
      invoice_status,
      package_name_snapshot,
      membership_name_snapshot,
      shop_product_name_snapshot,
      service_title_snapshot,
      studios ( name, public_contact_email )
    `,
    )
    .eq("id", paymentId)
    .single();
  return { admin, payment: (data ?? null) as InvoicePaymentRow | null, error };
}

export async function resolveInvoicePayload(
  admin: ReturnType<typeof createAdminClient>,
  payment: InvoicePaymentRow,
  options?: { assignInvoiceNumberForPaid?: boolean },
): Promise<ResolvedInvoicePayload> {
  let invoiceNumber = payment.invoice_number;
  if (!invoiceNumber && payment.status === "paid" && options?.assignInvoiceNumberForPaid) {
    const { data: assigned, error: assignError } = await admin.rpc("assign_payment_invoice_number", {
      p_payment_id: payment.id,
    });
    if (assignError || assigned == null || String(assigned).trim() === "") {
      throw new Error(assignError?.message ?? "invoice_assign_failed");
    }
    invoiceNumber = String(assigned);
  }
  if (!invoiceNumber) {
    invoiceNumber = `DRAFT-${payment.id.slice(0, 8).toUpperCase()}`;
  }

  let customerName = payment.guest_name?.trim() || "Member";
  let customerEmail: string | null = payment.guest_email?.trim() || null;

  const studio = Array.isArray(payment.studios) ? payment.studios[0] : payment.studios;
  const studioName = studio?.name?.trim() || "Studio";
  const studioEmail = studio?.public_contact_email?.trim() || null;

  if (payment.client_id) {
    const [{ data: user }, { data: profile }] = await Promise.all([
      admin.from("users").select("email").eq("id", payment.client_id).maybeSingle(),
      admin.from("user_profiles").select("full_name").eq("id", payment.client_id).maybeSingle(),
    ]);
    const fullName = profile?.full_name?.trim() || null;
    const email = user?.email?.trim() || null;
    if (fullName) customerName = fullName;
    else if (email) customerName = email;
    if (email) customerEmail = email;
  }

  let lineItem =
    payment.source === "event_booking"
      ? "Event booking"
      : payment.source === "membership_subscription"
        ? "Membership subscription"
        : payment.source === "member_zone_purchase"
          ? "Member zone purchase"
          : payment.source === "shop_purchase"
            ? "Shop purchase"
            : payment.source === "service_purchase"
              ? "Service purchase"
            : payment.type === "package" || payment.source === "package_buy"
              ? "Package purchase"
              : "Class booking";

  if (payment.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("guest_name, guest_email, class_sessions ( classes ( title ) )")
      .eq("id", payment.booking_id)
      .maybeSingle();
    if (booking?.guest_name?.trim()) customerName = booking.guest_name.trim();
    if (booking?.guest_email?.trim()) customerEmail = booking.guest_email.trim();
    const session = Array.isArray(booking?.class_sessions) ? booking.class_sessions[0] : booking?.class_sessions;
    const cls = Array.isArray(session?.classes) ? session.classes[0] : session?.classes;
    if (cls?.title?.trim()) lineItem = `Class: ${cls.title.trim()}`;
  } else if (payment.event_booking_id) {
    const { data: eventBooking } = await admin
      .from("event_bookings")
      .select("guest_name, guest_email, events ( title )")
      .eq("id", payment.event_booking_id)
      .maybeSingle();
    if (eventBooking?.guest_name?.trim()) customerName = eventBooking.guest_name.trim();
    if (eventBooking?.guest_email?.trim()) customerEmail = eventBooking.guest_email.trim();
    const event = Array.isArray(eventBooking?.events) ? eventBooking.events[0] : eventBooking?.events;
    if (event?.title?.trim()) lineItem = `Event: ${event.title.trim()}`;
  } else if (payment.package_name_snapshot?.trim()) {
    lineItem = `Package: ${payment.package_name_snapshot.trim()}`;
  } else if (payment.package_id) {
    const { data: pkg } = await admin.from("packages").select("name").eq("id", payment.package_id).maybeSingle();
    if (pkg?.name?.trim()) lineItem = `Package: ${pkg.name.trim()}`;
  } else if (payment.membership_name_snapshot?.trim()) {
    lineItem = `Membership: ${payment.membership_name_snapshot.trim()}`;
  } else if (payment.shop_product_name_snapshot?.trim()) {
    lineItem = `Shop: ${payment.shop_product_name_snapshot.trim()}`;
  } else if (payment.service_title_snapshot?.trim()) {
    lineItem = `Service: ${payment.service_title_snapshot.trim()}`;
  } else if (payment.service_id) {
    const { data: service } = await admin.from("studio_services").select("title").eq("id", payment.service_id).maybeSingle();
    if (service?.title?.trim()) lineItem = `Service: ${service.title.trim()}`;
  } else if (payment.member_zone_lesson_id) {
    const { data: lesson } = await admin
      .from("member_zone_lessons")
      .select("title")
      .eq("id", payment.member_zone_lesson_id)
      .maybeSingle();
    if (lesson?.title?.trim()) lineItem = `Member zone lesson: ${lesson.title.trim()}`;
  } else if (payment.member_zone_series_id) {
    const { data: series } = await admin
      .from("member_zone_series")
      .select("title")
      .eq("id", payment.member_zone_series_id)
      .maybeSingle();
    if (series?.title?.trim()) lineItem = `Member zone series: ${series.title.trim()}`;
  }

  return {
    invoiceNumber,
    studioName,
    studioEmail,
    customerName,
    customerEmail,
    currency: payment.currency ?? "SGD",
    amount: Number(payment.amount ?? 0),
    issueDate: toISODateLabel(payment.verified_at ?? payment.created_at),
    referenceCode: payment.reference_code ?? null,
    lineItem,
  };
}

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves a client_id for booking/payment records.
 * - If email already exists in public.users, reuse that id.
 * - Else create an auth user (shadow account) and return its id.
 */
export async function resolveClientIdByEmail(
  admin: SupabaseClient,
  input: { email: string; name?: string | null; phone?: string | null },
): Promise<string> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle<{ id: string }>();

  if (existing?.id) return existing.id;

  const password = randomBytes(24).toString("base64url");
  const { data: created, error } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: {
      role: "client",
      full_name: input.name?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
    },
  });

  if (error) {
    // Avoid race-condition failures when two requests create the same email.
    const { data: again } = await admin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle<{ id: string }>();
    if (again?.id) return again.id;
    throw new Error(error.message || "client_identity_create_failed");
  }

  const userId = created.user?.id;
  if (!userId) throw new Error("client_identity_missing_id");
  return userId;
}

export async function ensurePaymentClientId(admin: SupabaseClient, paymentId: string): Promise<string | null> {
  const { data: payment } = await admin
    .from("payments")
    .select("id, client_id, booking_id, event_booking_id, guest_name, guest_email, guest_phone")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment?.id) return null;
  if (payment.client_id) return payment.client_id;

  let email = payment.guest_email?.trim().toLowerCase() ?? "";
  let name = payment.guest_name?.trim() ?? null;
  let phone = payment.guest_phone?.trim() ?? null;

  if ((!email || email.length === 0) && payment.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("id, client_id, guest_name, guest_email, guest_phone")
      .eq("id", payment.booking_id)
      .maybeSingle();
    if (booking?.client_id) {
      await admin.from("payments").update({ client_id: booking.client_id }).eq("id", payment.id);
      return booking.client_id;
    }
    email = booking?.guest_email?.trim().toLowerCase() ?? "";
    name = booking?.guest_name?.trim() ?? name;
    phone = booking?.guest_phone?.trim() ?? phone;
  }

  if ((!email || email.length === 0) && (payment as { event_booking_id?: string | null }).event_booking_id) {
    const { data: booking } = await admin
      .from("event_bookings")
      .select("id, client_id, guest_name, guest_email, guest_phone")
      .eq("id", (payment as { event_booking_id: string }).event_booking_id)
      .maybeSingle();
    if (booking?.client_id) {
      await admin.from("payments").update({ client_id: booking.client_id }).eq("id", payment.id);
      return booking.client_id;
    }
    email = booking?.guest_email?.trim().toLowerCase() ?? "";
    name = booking?.guest_name?.trim() ?? name;
    phone = booking?.guest_phone?.trim() ?? phone;
  }

  if (!email) return null;

  const clientId = await resolveClientIdByEmail(admin, { email, name, phone });
  await admin.from("payments").update({ client_id: clientId }).eq("id", payment.id);
  if (payment.booking_id) {
    await admin.from("bookings").update({ client_id: clientId }).eq("id", payment.booking_id);
  }
  if ((payment as { event_booking_id?: string | null }).event_booking_id) {
    await admin.from("event_bookings").update({ client_id: clientId }).eq("id", (payment as { event_booking_id: string }).event_booking_id);
  }
  return clientId;
}

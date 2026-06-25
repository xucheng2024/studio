import type { SupabaseClient } from "@supabase/supabase-js";
import { createHitpayPaymentRequest } from "@/lib/hitpay";
import { cancelPendingPaymentLifecycle } from "@/lib/paymentStatusTransitions";
import { finalizeZeroAmountPayment } from "@/lib/finalizeZeroAmountPayment";

type BookingCheckoutKind = "class" | "event";
type InstantBookingKind = "class" | "event";

type BookingCheckoutGiftInput = {
  isGift: boolean;
  giftRecipientName?: string | null;
  giftRecipientEmail?: string | null;
  giftMessage?: string | null;
};

type BookingCheckoutGuestInput = {
  userId?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
};

type CreatePendingClassBookingReservationInput = BookingCheckoutGuestInput & {
  sessionId: string;
  isGift?: boolean;
  giftRecipientName?: string | null;
  giftRecipientEmail?: string | null;
};

type CreatePendingEventBookingReservationInput = BookingCheckoutGuestInput & {
  eventId: string;
  isGift?: boolean;
  giftRecipientName?: string | null;
  giftRecipientEmail?: string | null;
};

type CreateBookingCheckoutPaymentInput = BookingCheckoutGuestInput & BookingCheckoutGiftInput & {
  kind: BookingCheckoutKind;
  reservationId: string;
  studioId: string;
  locationId?: string | null;
  amount: number;
  currency: string;
  referenceCode: string;
  expiresAt: string;
};

type FinalizeBookingCheckoutInput = {
  paymentId: string;
  studioId: string;
  reservationId: string;
  kind: BookingCheckoutKind;
};

export function getTimedBookingCheckoutExpiry(startTime: string | null | undefined) {
  const startAtMs = startTime ? new Date(startTime).getTime() : null;
  const nowMs = Date.now();
  const minExpiry = nowMs + 60 * 1000;
  const maxExpiry = nowMs + 15 * 60 * 1000;
  const hardCap = startAtMs ? startAtMs - 5 * 60 * 1000 : null;
  const upperBound = hardCap != null ? Math.min(maxExpiry, hardCap) : maxExpiry;
  return new Date(Math.max(minExpiry, upperBound)).toISOString();
}

export async function createPendingClassBookingReservation(
  admin: SupabaseClient,
  input: CreatePendingClassBookingReservationInput,
) {
  const rpcClientId = input.isGift ? null : (input.userId ?? null);
  const rpcGuestName = rpcClientId ? null : (input.guestName ?? input.giftRecipientName ?? "Gift recipient");
  const rpcGuestEmail = rpcClientId ? null : (input.guestEmail ?? input.giftRecipientEmail ?? null);
  const { data, error } = await admin.rpc("create_pending_booking", {
    p_session_id: input.sessionId,
    p_client_id: rpcClientId,
    p_guest_name: rpcGuestName,
    p_guest_email: rpcGuestEmail,
    p_guest_phone: rpcClientId ? null : (input.guestPhone ?? null),
  });
  if (error) {
    return { ok: false as const, status: 500, error: error.message };
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    booking_id?: string;
    credits_required?: number;
    guest_price?: number;
  } | null;
  if (!result?.ok || !result.booking_id) {
    return {
      ok: false as const,
      status: 409,
      error: result?.error ?? "booking_create_failed",
    };
  }
  return {
    ok: true as const,
    reservationId: result.booking_id,
    creditsRequired: result.credits_required ?? null,
  };
}

export async function createPendingEventBookingReservation(
  admin: SupabaseClient,
  input: CreatePendingEventBookingReservationInput,
) {
  const rpcClientId = input.isGift ? null : (input.userId ?? null);
  const rpcGuestName = rpcClientId ? null : (input.guestName ?? input.giftRecipientName ?? "Gift recipient");
  const rpcGuestEmail = rpcClientId ? null : (input.guestEmail ?? input.giftRecipientEmail ?? null);
  const { data, error } = await admin.rpc("create_pending_event_booking", {
    p_event_id: input.eventId,
    p_client_id: rpcClientId,
    p_guest_name: rpcGuestName,
    p_guest_email: rpcGuestEmail,
    p_guest_phone: rpcClientId ? null : (input.guestPhone ?? null),
  });
  if (error) {
    return { ok: false as const, status: 500, error: error.message };
  }

  const result = data as { ok?: boolean; error?: string; event_booking_id?: string } | null;
  if (!result?.ok || !result.event_booking_id) {
    return {
      ok: false as const,
      status: 409,
      error: result?.error ?? "booking_create_failed",
    };
  }
  return {
    ok: true as const,
    reservationId: result.event_booking_id,
  };
}

export async function createBookingCheckoutPayment(
  admin: SupabaseClient,
  input: CreateBookingCheckoutPaymentInput,
) {
  const { data, error } = await admin
    .from("payments")
    .insert({
      booking_id: input.kind === "class" ? input.reservationId : null,
      event_booking_id: input.kind === "event" ? input.reservationId : null,
      package_id: null,
      studio_id: input.studioId,
      location_id: input.locationId ?? null,
      client_id: input.userId ?? null,
      guest_name: input.userId ? null : (input.guestName ?? null),
      guest_email: input.userId ? null : (input.guestEmail ?? null),
      guest_phone: input.userId ? null : (input.guestPhone ?? null),
      is_gift: input.isGift,
      gift_recipient_name: input.isGift ? (input.giftRecipientName ?? null) : null,
      gift_recipient_email: input.isGift ? (input.giftRecipientEmail ?? null) : null,
      gift_message: input.isGift ? (input.giftMessage ?? null) : null,
      amount: input.amount,
      currency: input.currency,
      payment_method: input.amount === 0 ? "free" : "hitpay",
      source: input.kind === "event" ? "event_booking" : "online_booking",
      status: "pending",
      reference_code: input.referenceCode,
      expires_at: input.expiresAt,
      type: "single",
      remaining_uses: 0,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data?.id) {
    return {
      ok: false as const,
      error: error?.message ?? "payment_create_failed",
    };
  }
  return { ok: true as const, paymentId: data.id };
}

export async function attachPaymentToBookingReservation(
  admin: SupabaseClient,
  input: { kind: BookingCheckoutKind; reservationId: string; paymentId: string },
) {
  const table = input.kind === "event" ? "event_bookings" : "bookings";
  await admin.from(table).update({ payment_id: input.paymentId }).eq("id", input.reservationId);
}

export async function rollbackPendingBookingReservation(
  admin: SupabaseClient,
  input: { kind: BookingCheckoutKind; reservationId: string; eventId?: string | null; restoreEventSpot?: boolean },
) {
  if (input.kind === "event") {
    await admin.from("event_bookings").delete().eq("id", input.reservationId);
    if (input.restoreEventSpot && input.eventId) {
      const { data: event } = await admin
        .from("events")
        .select("spots_left")
        .eq("id", input.eventId)
        .maybeSingle<{ spots_left: number | null }>();
      await admin
        .from("events")
        .update({ spots_left: Number(event?.spots_left ?? 0) + 1 })
        .eq("id", input.eventId);
    }
    return;
  }
  await admin.from("bookings").delete().eq("id", input.reservationId);
}

export async function finalizeBookingCheckout(
  admin: SupabaseClient,
  input: FinalizeBookingCheckoutInput,
) {
  await finalizeZeroAmountPayment(admin, {
    id: input.paymentId,
    studio_id: input.studioId,
    booking_id: input.kind === "class" ? input.reservationId : null,
    event_booking_id: input.kind === "event" ? input.reservationId : null,
  });
}

export async function cancelPendingBookingCheckout(
  admin: SupabaseClient,
  input: { paymentId: string; studioId: string; reservationId: string; kind: BookingCheckoutKind },
) {
  await cancelPendingPaymentLifecycle(
    admin,
    {
      id: input.paymentId,
      studio_id: input.studioId,
      booking_id: input.kind === "class" ? input.reservationId : null,
      event_booking_id: input.kind === "event" ? input.reservationId : null,
    },
    "failed",
  );
}

export async function attachHitpayCheckoutToBookingPayment(
  admin: SupabaseClient,
  input: {
    paymentId: string;
    providerPaymentId: string | null;
    checkoutUrl: string;
    providerStatus: string | null;
  },
) {
  await admin
    .from("payments")
    .update({
      gateway_payment_id: input.providerPaymentId,
      gateway_checkout_url: input.checkoutUrl,
      gateway_status: input.providerStatus,
    })
    .eq("id", input.paymentId);
}

export async function createHitpayBookingCheckout(
  input: {
    apiKey: string;
    amount: number;
    currency: string;
    email?: string | null;
    name?: string | null;
    referenceCode: string;
    returnUrl: string;
    purpose: string;
  },
) {
  return createHitpayPaymentRequest({
    apiKey: input.apiKey,
    amount: input.amount.toFixed(2),
    currency: input.currency,
    email: input.email ?? null,
    name: input.name ?? null,
    reference_number: input.referenceCode,
    redirect_url: input.returnUrl,
    purpose: input.purpose,
  });
}

type CreateInstantBookingSaleInput = {
  kind: InstantBookingKind;
  targetId: string;
  studioId: string;
  locationId?: string | null;
  guestName: string;
  guestEmail?: string | null;
  guestPhone?: string | null;
  amount: number;
  currency: string;
  paymentMethod: "hitpay" | "cash";
  actorId: string;
};

export async function createInstantBookingSale(
  admin: SupabaseClient,
  input: CreateInstantBookingSaleInput,
) {
  const bookingTable = input.kind === "event" ? "event_bookings" : "bookings";
  const targetIdColumn = input.kind === "event" ? "event_id" : "session_id";

  const bookingInsert =
    input.kind === "event"
      ? {
          event_id: input.targetId,
          location_id: input.locationId ?? null,
          client_id: null,
          guest_name: input.guestName,
          guest_email: input.guestEmail ?? null,
          guest_phone: input.guestPhone ?? null,
          status: "booked",
          payment_status: "paid",
        }
      : {
          session_id: input.targetId,
          location_id: input.locationId ?? null,
          client_id: null,
          guest_name: input.guestName,
          guest_email: input.guestEmail ?? null,
          guest_phone: input.guestPhone ?? null,
          status: "booked",
          payment_status: "paid",
        };

  const { data: booking, error: bookingError } = await admin
    .from(bookingTable)
    .insert(bookingInsert)
    .select("id")
    .single<{ id: string }>();
  if (bookingError || !booking?.id) {
    return {
      ok: false as const,
      status: 500,
      error: bookingError?.message ?? "booking_create_failed",
    };
  }

  const paymentInsert =
    input.kind === "event"
      ? {
          event_booking_id: booking.id,
          studio_id: input.studioId,
          location_id: input.locationId ?? null,
          guest_name: input.guestName,
          guest_email: input.guestEmail ?? null,
          guest_phone: input.guestPhone ?? null,
          amount: input.amount,
          currency: input.currency,
          type: "single",
          source: "walkin",
          status: "paid",
          payment_method: input.paymentMethod,
          paid_at: new Date().toISOString(),
          verified_at: new Date().toISOString(),
          verified_by: input.actorId,
          remaining_uses: 1,
        }
      : {
          booking_id: booking.id,
          studio_id: input.studioId,
          location_id: input.locationId ?? null,
          amount: input.amount,
          currency: input.currency,
          type: "single",
          source: "walkin",
          status: "paid",
          payment_method: input.paymentMethod,
          paid_at: new Date().toISOString(),
          verified_at: new Date().toISOString(),
          verified_by: input.actorId,
          remaining_uses: 1,
        };

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .insert(paymentInsert)
    .select("id")
    .single<{ id: string }>();
  if (paymentError || !payment?.id) {
    await admin.from(bookingTable).delete().eq("id", booking.id);
    return {
      ok: false as const,
      status: 500,
      error: paymentError?.message ?? "payment_create_failed",
    };
  }

  await admin.from(bookingTable).update({ payment_id: payment.id }).eq("id", booking.id);
  const seatRpcName =
    input.kind === "event"
      ? "decrement_event_spot_if_available"
      : "decrement_class_session_spot_if_available";
  const seatRpcParams =
    input.kind === "event"
      ? { p_event_id: input.targetId }
      : { p_session_id: input.targetId };
  const { data: seatReserved, error: seatError } = await admin.rpc(seatRpcName, seatRpcParams);

  if (seatError || seatReserved !== true) {
    const failedBookingPatch =
      input.kind === "event"
        ? { status: "cancelled" }
        : { status: "cancelled", cancel_reason: "full_race" };
    await admin.from(bookingTable).update(failedBookingPatch).eq("id", booking.id);
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    return {
      ok: false as const,
      status: seatError ? 500 : 409,
      error: seatError?.message ?? "full",
    };
  }

  return {
    ok: true as const,
    bookingId: booking.id,
    paymentId: payment.id,
    targetColumn: targetIdColumn,
  };
}

export async function runInstantBookingCheckin(
  admin: SupabaseClient,
  input: { kind: InstantBookingKind; bookingId: string; actorId: string },
) {
  const rpcName = input.kind === "event" ? "checkin_event_booking" : "checkin_booking";
  const rpcParams =
    input.kind === "event"
      ? { p_event_booking_id: input.bookingId, p_actor_id: input.actorId }
      : { p_booking_id: input.bookingId, p_actor_id: input.actorId };
  const { data, error } = await admin.rpc(rpcName, rpcParams);
  const result = data as { ok?: boolean; error?: string } | null;
  return {
    ok: !error && result?.ok === true,
    error: error?.message ?? (result?.ok === false ? (result?.error ?? "checkin_failed") : undefined),
  };
}

export async function loadClassSessionBookingStudio(
  admin: SupabaseClient,
  sessionId: string,
) {
  const { data: sessionRow } = await admin
    .from("class_sessions")
    .select("id, status, location_id, classes!inner(studio_id)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!sessionRow) {
    return { ok: false as const, status: 404, error: "session_not_found" };
  }
  if ((sessionRow.status ?? "scheduled") !== "scheduled") {
    return { ok: false as const, status: 409, error: "session_not_available" };
  }

  const cls = sessionRow.classes as { studio_id?: string } | { studio_id?: string }[] | null;
  const studioId = Array.isArray(cls) ? cls[0]?.studio_id : cls?.studio_id;

  return {
    ok: true as const,
    session: sessionRow,
    studioId: studioId ?? null,
    locationId: sessionRow.location_id ?? null,
  };
}

export async function createAutoMemberClassBooking(
  admin: SupabaseClient,
  input: { sessionId: string; clientId: string },
) {
  const { data, error } = await admin.rpc("create_member_booking_auto", {
    p_session_id: input.sessionId,
    p_client_id: input.clientId,
  });
  if (error) {
    return { ok: false as const, status: 500, error: error.message };
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    booking_id?: string;
    selected_package_id?: string;
    credits_required?: number;
  } | null;
  if (!result?.ok) {
    return {
      ok: false as const,
      status: 409,
      error: result?.error ?? "member_booking_failed",
    };
  }

  return {
    ok: true as const,
    bookingId: result.booking_id ?? null,
    selectedPackageId: result.selected_package_id ?? null,
    creditsRequired: result.credits_required ?? null,
  };
}

export async function createManualPackageClassBooking(
  admin: SupabaseClient,
  input: { sessionId: string; clientId: string; clientPackageId: string },
) {
  const { data, error } = await admin.rpc("create_package_booking", {
    p_session_id: input.sessionId,
    p_client_id: input.clientId,
    p_client_package_id: input.clientPackageId,
  });
  if (error) {
    return { ok: false as const, status: 500, error: error.message };
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    booking_id?: string;
    credits_required?: number;
  } | null;
  if (!result?.ok) {
    return {
      ok: false as const,
      status: 409,
      error: result?.error ?? "package_booking_failed",
    };
  }

  return {
    ok: true as const,
    bookingId: result.booking_id ?? null,
    creditsRequired: result.credits_required ?? null,
  };
}

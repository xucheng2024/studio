type HitpayConfigIssueInput = {
  hitpayEnabled: boolean | null | undefined;
  merchantApiKey: string | null | undefined;
};

export type PaymentErrorResponse = {
  error: string;
  error_detail?: string;
  status: number;
};

export function getHitpayConfigIssue(input: HitpayConfigIssueInput): PaymentErrorResponse | null {
  if (!input.hitpayEnabled) {
    return {
      error: "hitpay_disabled_for_studio",
      error_detail: "Studio setting `hitpay_enabled` is false.",
      status: 409,
    };
  }
  if (!input.merchantApiKey?.trim()) {
    return {
      error: "hitpay_merchant_key_missing",
      error_detail: "Missing `studio_payment_secrets.hitpay_api_key` for this studio.",
      status: 409,
    };
  }
  return null;
}

export function normalizeHitpayError(message: string): PaymentErrorResponse {
  const code = String(message || "").trim();
  if (!code) {
    return { error: "hitpay_create_failed", status: 502 };
  }
  if (
    code === "hitpay_merchant_key_missing" ||
    code === "hitpay_disabled_for_studio" ||
    code === "hitpay_not_configured"
  ) {
    return {
      error: code,
      status: 409,
    };
  }
  if (code === "hitpay_invalid_response") {
    return {
      error: "hitpay_invalid_response",
      error_detail: "HitPay response did not include checkout URL or payment id.",
      status: 502,
    };
  }
  if (code.startsWith("hitpay_")) {
    return { error: code, status: 502 };
  }
  return {
    error: "hitpay_gateway_error",
    error_detail: code,
    status: 502,
  };
}

export function paymentErrorMessage(error: string, detail?: string) {
  const base =
    error === "full"
      ? "No more spots are available."
      : error === "must_uncheckin_first"
        ? "Guest is checked in. Use Uncheck-in first, then cancel or refund."
        : error === "already_has_booking"
        ? "You already have a booking for this item."
        : error === "guest_details_required"
          ? "Please enter your name, email, and phone number."
          : error === "subscription_exists"
            ? "You already have an active or pending membership for this plan."
            : error === "purchase_pending"
              ? "You already have a pending payment for this item."
              : error === "out_of_stock"
                ? "This item is out of stock."
              : error === "already_purchased"
                ? "This item has already been purchased."
                : error === "already_member"
                  ? "You already have an active membership."
                  : error === "hitpay_disabled_for_studio"
                    ? "HitPay is disabled for this studio."
                    : error === "hitpay_merchant_key_missing"
                      ? "Studio HitPay API key is missing."
                      : error === "hitpay_not_configured"
                          ? "HitPay is not fully configured."
                          : error === "hitpay_invalid_response"
                            ? "HitPay returned an invalid response."
                            : error === "hitpay_gateway_error"
                              ? "HitPay rejected this payment request."
                              : error === "studio_forbidden"
                                ? "You cannot purchase from this studio with your current account."
                                : error === "studio_context_mismatch"
                                  ? "You are signed in under a different studio. Open this studio’s site and try again."
                                  : error === "studio_suspended"
                                    ? "This studio is not accepting payments right now."
                  : error === "studio_not_found"
                    ? "Studio not found."
                    : error === "event_external_booking_url"
                      ? "This event is booked on an external site. Use Book now on the event page."
                      : error === "gift_recipient_email_required"
                        ? "Please enter the recipient's email address."
                        : error === "gift_self_not_allowed"
                          ? "You cannot send a gift to yourself."
                          : error === "gift_recipient_already_has_access"
                            ? "The recipient already has a booking for this event."
                            : error === "gift_recipient_already_has_order"
                              ? "The recipient already has this product."
                              : error === "invalid_body"
                                ? "Please review your details and try again."
                              : error === "product_not_found"
                                ? "This product was not found."
                                : error === "product_not_available"
                                  ? "This product is no longer available."
                                : error === "service_not_found"
                                  ? "This service was not found."
                                  : error === "service_not_available"
                                    ? "This service is no longer available."
                                    : error === "service_price_missing"
                                      ? "This service does not have a price set yet."
                                    : error === "service_payment_disabled"
                                      ? "Online payment is not enabled for this service."
                                : error === "payment_create_failed"
                                    ? "Could not create the payment. Please try again."
                                    : error === "free_payment_finalize_failed"
                                      ? "We couldn't finish your free order automatically. Please try again."
                                    : error === "order_create_failed"
                                      ? "Could not create your order. Please try again."
                                      : error === "service_order_create_failed"
                                        ? "Could not create your service order. Please try again."
                            : "Could not continue payment.";
  if (!detail) return base;
  return `${base} (${detail})`;
}

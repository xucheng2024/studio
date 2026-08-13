export type PaymentOrderType =
  | "session"
  | "event"
  | "package"
  | "membership"
  | "member_zone"
  | "shop"
  | "service";

export type PaymentSalesChannel = "online" | "frontdesk" | "dashboard" | "system";

type PaymentClassificationInput = {
  source?: string | null;
  bookingId?: string | null;
  eventBookingId?: string | null;
  salesChannel?: string | null;
};

export function paymentOrderType(input: PaymentClassificationInput): PaymentOrderType {
  switch (input.source) {
    case "pos_sale":
      return "service";
    case "event_booking":
      return "event";
    case "package_buy":
      return "package";
    case "membership_subscription":
      return "membership";
    case "member_zone_purchase":
      return "member_zone";
    case "shop_purchase":
      return "shop";
    case "service_purchase":
      return "service";
    case "walkin":
      return input.eventBookingId ? "event" : "session";
    default:
      return "session";
  }
}

export function paymentOrderTypeLabel(input: PaymentClassificationInput) {
  switch (paymentOrderType(input)) {
    case "event":
      return "Event";
    case "package":
      return "Package";
    case "membership":
      return "Membership";
    case "member_zone":
      return "Member zone";
    case "shop":
      return "Shop";
    case "service":
      return "Service";
    default:
      return "Session";
  }
}

export function paymentSalesChannel(input: PaymentClassificationInput): PaymentSalesChannel {
  const raw = String(input.salesChannel ?? "").trim().toLowerCase();
  if (raw === "frontdesk" || raw === "dashboard" || raw === "system" || raw === "online") {
    return raw;
  }
  if (input.source === "walkin") return "frontdesk";
  return "online";
}

export function paymentSalesChannelLabel(input: PaymentClassificationInput) {
  switch (paymentSalesChannel(input)) {
    case "frontdesk":
      return "Frontdesk";
    case "dashboard":
      return "Dashboard";
    case "system":
      return "System";
    default:
      return "Online";
  }
}

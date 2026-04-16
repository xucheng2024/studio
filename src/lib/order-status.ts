export type BadgeTone = "stone" | "amber" | "teal" | "red" | "blue";

export type OrderBadge = {
  text: string;
  tone: BadgeTone;
};

function paymentStatusBadge(status: string | null | undefined): OrderBadge {
  switch (status) {
    case "paid":
      return { text: "Paid", tone: "teal" };
    case "pending":
      return { text: "Pending", tone: "amber" };
    case "failed":
      return { text: "Failed", tone: "red" };
    case "expired":
      return { text: "Expired", tone: "stone" };
    case "refunded":
      return { text: "Refunded", tone: "blue" };
    default:
      return { text: "Unknown payment", tone: "stone" };
  }
}

function bookingStatusBadge(status: string | null | undefined): OrderBadge {
  switch (status) {
    case "booked":
      return { text: "Booked", tone: "blue" };
    case "attended":
      return { text: "Checked in", tone: "teal" };
    case "pending":
      return { text: "Pending", tone: "amber" };
    case "cancelled":
      return { text: "Cancelled", tone: "stone" };
    case "late_cancel":
      return { text: "Late cancel", tone: "amber" };
    case "no_show":
      return { text: "No-show", tone: "red" };
    default:
      return { text: "Unknown booking", tone: "stone" };
  }
}

function reconStatusBadge(status: string | null | undefined): OrderBadge {
  switch (status) {
    case "matched":
      return { text: "Matched", tone: "teal" };
    case "mismatch":
      return { text: "Mismatch", tone: "red" };
    case "manual_review":
    case "needs_review":
      return { text: "Manual review", tone: "amber" };
    case "awaiting_verification":
      return { text: "Awaiting verification", tone: "amber" };
    default:
      return { text: "No recon status", tone: "stone" };
  }
}

export function getUnifiedStatusBadges(input: {
  booking_status?: string | null;
  payment_status?: string | null;
  recon_status?: string | null;
}) {
  return {
    booking: bookingStatusBadge(input.booking_status),
    payment: paymentStatusBadge(input.payment_status),
    recon: reconStatusBadge(input.recon_status),
  };
}

export function badgeToneClass(tone: BadgeTone) {
  switch (tone) {
    case "teal":
      return "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100";
    case "amber":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
    case "red":
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100";
    case "blue":
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100";
    default:
      return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200";
  }
}

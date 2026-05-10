/** White-label copy — gyms, yoga studios, multi-venue fitness. */

export const site = {
  name: "Studio",
  title: "Studio — Bookings Made Simple",
  contactEmail: "business@sgmystudio.com",
  description:
    "Hosted checkout booking, automatic payment tracking, and a front desk dashboard for Singapore fitness studios.",
  badge: "For health & wellness studios",
  homeHeadline: "Run your studio without the admin pile",
  homeLead:
    "Hosted booking links, automatic payment tracking, and a front desk dashboard — built for Singapore studios. No more manual transfer matching.",
  marketing: {
    memberHighlights: [
      "Pick any class and book in under a minute with real-time availability.",
      "Pay online with hosted checkout and instant status updates.",
      "Cancellation windows and class pass rules are shown clearly before you book.",
      "Booked as a guest before? Sign in with the same email to sync your history.",
    ],
    memberIntro:
      "Sign in to track bookings, class passes, and payments without back-and-forth messages.",
    ownerHighlights: [
      "Today's pending payments, arrivals, and exceptions — one front desk view",
      "Filter, search, and export payment records with a full audit trail",
      "Invoice PDFs sent automatically once payment is confirmed",
    ],
    ownerIntro:
      "Fewer manual steps, better visibility — across sessions, locations, and payment methods.",
    paymentFlowNote:
      "Online payments are reconciled through gateway callbacks.",
    mergeNote:
      "Use the same email as your guest bookings to merge records automatically.",
  },
} as const;

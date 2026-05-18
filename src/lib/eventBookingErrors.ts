/** User-facing copy for event booking / check-in / cancel errors. */
export function eventBookingErrorMessage(error: string): string {
  switch (error) {
    case "must_uncheckin_first":
      return "Guest is checked in. Use Uncheck-in first, then cancel or refund.";
    case "already_has_booking":
      return "This guest already has a booking for this event.";
    case "not_booked":
      return "Only booked guests can be checked in.";
    case "not_attended":
      return "Guest is not checked in.";
    case "full":
      return "No more spots are available for this event.";
    case "event_booking_not_found":
      return "Event booking not found.";
    case "cancel_failed":
      return "Could not cancel this booking. Please try again.";
    case "checkin_failed":
      return "Check-in failed. Please try again.";
    case "uncheckin_failed":
      return "Could not undo check-in. Please try again.";
    case "gift_recipient_already_has_access":
      return "The recipient already has a booking for this event.";
    default:
      return error ? error.replaceAll("_", " ") : "Something went wrong. Please try again.";
  }
}

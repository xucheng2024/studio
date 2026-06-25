export function sessionActionErrorMessage(
  error: string | null | undefined,
  detail?: string | null,
  sessionStatus?: string | null,
): string {
  const code = String(error ?? "").trim();

  if (detail) return detail;

  switch (code) {
    case "capacity_below_booked":
      return "Capacity cannot be lower than the number of booked attendees.";
    case "session_completed":
      return "Completed sessions can no longer be edited.";
    case "session_cancelled":
      return "Cancelled sessions can no longer be edited.";
    case "session_not_cancellable":
      if (sessionStatus === "completed") return "Completed sessions cannot be cancelled.";
      if (sessionStatus === "cancelled") return "This session has already been cancelled.";
      return "This session can no longer be cancelled.";
    case "refund_failed":
      return "A refund could not be completed automatically. No changes were applied.";
    case "invalid_location":
      return "Choose a valid active location for this studio.";
    case "invalid_start_time":
      return "Start time is invalid.";
    case "invalid_body":
      return "Please review the session details and try again.";
    case "not_found":
    case "session_not_found":
      return "Session not found.";
    case "unauthorized":
      return "You do not have access to do this.";
    default:
      return code ? code.replaceAll("_", " ") : "Something went wrong. Please try again.";
  }
}

export function sessionCheckinErrorMessage(error: string | null | undefined): string {
  const code = String(error ?? "").trim();

  switch (code) {
    case "forbidden":
      return "You do not have access to check in this attendee.";
    case "not_found":
      return "Booking not found.";
    case "not_booked":
      return "Only booked attendees can be checked in.";
    case "not_attended":
      return "This attendee is not checked in.";
    case "invalid_body":
      return "Please refresh and try again.";
    case "unauthorized":
      return "Please sign in again to continue.";
    case "checkin_failed":
      return "Check-in failed. Please try again.";
    case "uncheckin_failed":
      return "Could not undo check-in. Please try again.";
    default:
      return code ? code.replaceAll("_", " ") : "Something went wrong. Please try again.";
  }
}

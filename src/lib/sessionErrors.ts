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

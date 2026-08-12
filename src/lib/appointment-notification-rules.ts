export const APPOINTMENT_NOTIFICATION_EVENT_TYPES = [
  "appointment_created",
  "appointment_confirmed",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_reminder_24h",
  "appointment_reminder_2h",
] as const;

export type AppointmentNotificationEventType = (typeof APPOINTMENT_NOTIFICATION_EVENT_TYPES)[number];

export type AppointmentNotificationQueueStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "invalidated";

export function mapTransitionStatusToAppointmentNotificationEvent(
  toStatus: string,
): AppointmentNotificationEventType | null {
  if (toStatus === "confirmed") return "appointment_confirmed";
  if (toStatus === "cancelled") return "appointment_cancelled";
  return null;
}

export function buildAppointmentNotificationDedupeKey(params: {
  studioId: string;
  appointmentId: string;
  eventType: AppointmentNotificationEventType;
  idempotencyKey: string;
}) {
  return [
    "apt05",
    params.studioId,
    params.appointmentId,
    params.eventType,
    params.idempotencyKey,
  ].join(":");
}

export function calculateAppointmentNotificationRetryDelaySeconds(
  attemptCount: number,
  baseDelaySeconds = 60,
  maxDelaySeconds = 3600,
) {
  const normalizedAttempt = Number.isFinite(attemptCount) ? Math.max(0, Math.floor(attemptCount)) : 0;
  const normalizedBase = Math.max(1, Math.floor(baseDelaySeconds));
  const normalizedMax = Math.max(normalizedBase, Math.floor(maxDelaySeconds));
  const raw = normalizedBase * 2 ** normalizedAttempt;
  return Math.min(normalizedMax, raw);
}

export function isReminderEvent(eventType: AppointmentNotificationEventType) {
  return eventType === "appointment_reminder_24h" || eventType === "appointment_reminder_2h";
}

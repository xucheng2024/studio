import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppointmentNotificationDedupeKey,
  isReminderEvent,
} from "../../src/lib/appointment-notification-rules.ts";

export {};

test("APT-05 cron: duplicate trigger key stays identical", () => {
  const keyA = buildAppointmentNotificationDedupeKey({
    studioId: "studio-1",
    appointmentId: "apt-1",
    eventType: "appointment_confirmed",
    idempotencyKey: "idem-transition-1",
  });
  const keyB = buildAppointmentNotificationDedupeKey({
    studioId: "studio-1",
    appointmentId: "apt-1",
    eventType: "appointment_confirmed",
    idempotencyKey: "idem-transition-1",
  });

  assert.equal(keyA, keyB);
});

test("APT-05 cron: reminder classification is explicit", () => {
  assert.equal(isReminderEvent("appointment_reminder_24h"), true);
  assert.equal(isReminderEvent("appointment_reminder_2h"), true);
  assert.equal(isReminderEvent("appointment_created"), false);
});

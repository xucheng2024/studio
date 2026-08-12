import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildAppointmentNotificationDedupeKey,
  mapTransitionStatusToAppointmentNotificationEvent,
} from "../../src/lib/appointment-notification-rules.ts";
import { buildAppointmentNotificationEmailContent } from "../../src/lib/email.ts";

export {};

test("APT-05 app contract: transition event mapping", () => {
  assert.equal(mapTransitionStatusToAppointmentNotificationEvent("confirmed"), "appointment_confirmed");
  assert.equal(mapTransitionStatusToAppointmentNotificationEvent("cancelled"), "appointment_cancelled");
  assert.equal(mapTransitionStatusToAppointmentNotificationEvent("completed"), null);
});

test("APT-05 app contract: dedupe key is stable for same input", () => {
  const key1 = buildAppointmentNotificationDedupeKey({
    studioId: "studio-1",
    appointmentId: "apt-1",
    eventType: "appointment_created",
    idempotencyKey: "idem-1",
  });
  const key2 = buildAppointmentNotificationDedupeKey({
    studioId: "studio-1",
    appointmentId: "apt-1",
    eventType: "appointment_created",
    idempotencyKey: "idem-1",
  });

  assert.equal(key1, key2);
});

test("APT-05 app contract: dedupe key differs across event types", () => {
  const created = buildAppointmentNotificationDedupeKey({
    studioId: "studio-1",
    appointmentId: "apt-1",
    eventType: "appointment_created",
    idempotencyKey: "idem-1",
  });
  const cancelled = buildAppointmentNotificationDedupeKey({
    studioId: "studio-1",
    appointmentId: "apt-1",
    eventType: "appointment_cancelled",
    idempotencyKey: "idem-1",
  });

  assert.notEqual(created, cancelled);
});

test("APT-05 app contract: email copy is English and event-specific", () => {
  const created = buildAppointmentNotificationEmailContent({
    eventType: "appointment_created",
    studioName: "Studio A",
    customerName: "Alex",
    serviceName: "Deep Tissue Massage",
    locationName: "Main Branch",
    startsAtIso: "2026-08-14T08:00:00.000Z",
  });

  const reminder = buildAppointmentNotificationEmailContent({
    eventType: "appointment_reminder_2h",
    studioName: "Studio A",
    customerName: "Alex",
    serviceName: "Deep Tissue Massage",
    locationName: "Main Branch",
    startsAtIso: "2026-08-14T08:00:00.000Z",
  });

  assert.match(created.subject, /Appointment Request Received/);
  assert.match(created.text, /We have received your appointment request\./);
  assert.doesNotMatch(created.text, /[\u4e00-\u9fff]/);
  assert.match(reminder.subject, /Appointment Reminder \(2h\)/);
  assert.match(reminder.text, /starts in about 2 hours/);
});

test("APT-05 app contract: ops notifications route exposes POST retry with owner/manager scope", () => {
  const source = fs.readFileSync(
    "src/app/api/operations/appointments/notifications/route.ts",
    "utf8",
  );

  assert.match(source, /export\s+async\s+function\s+POST\s*\(/);
  assert.match(source, /roles:\s*\["owner",\s*"manager"\]/);
  assert.match(source, /retryAppointmentEmailNotificationJob\(/);
});

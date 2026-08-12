import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  calculateAppointmentNotificationRetryDelaySeconds,
} from "../../src/lib/appointment-notification-rules.ts";

export {};

test("APT-05 db queue: retry delay uses exponential backoff with cap", () => {
  assert.equal(calculateAppointmentNotificationRetryDelaySeconds(0, 60, 3600), 60);
  assert.equal(calculateAppointmentNotificationRetryDelaySeconds(1, 60, 3600), 120);
  assert.equal(calculateAppointmentNotificationRetryDelaySeconds(2, 60, 3600), 240);
  assert.equal(calculateAppointmentNotificationRetryDelaySeconds(20, 60, 3600), 3600);
});

test("APT-05 db queue: migration defines required queue statuses", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260812230000_apt05_appointment_email_notifications.sql",
    "utf8",
  );

  for (const status of ["pending", "processing", "sent", "failed", "invalidated"]) {
    assert.equal(
      migration.includes(`'${status}'`),
      true,
      `migration should include status '${status}'`,
    );
  }
});

test("APT-05 db queue: migration contains reminder invalidation rule", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260812230000_apt05_appointment_email_notifications.sql",
    "utf8",
  );

  assert.equal(migration.includes("stale_after_reschedule_or_cancel"), true);
  assert.equal(migration.includes("appointment_reminder_24h"), true);
  assert.equal(migration.includes("appointment_reminder_2h"), true);
});

test("APT-05 db queue: manual retry RPC exists", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260812235000_apt05_manual_retry_rpc.sql",
    "utf8",
  );

  assert.equal(migration.includes("retry_appointment_notification_email_job"), true);
  assert.equal(migration.includes("appointment_notification_retry_requested"), true);
});

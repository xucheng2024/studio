import assert from "node:assert/strict";
import test from "node:test";
import { WALKIN_START_GRACE_MS, walkinStartIsOpen } from "../../src/lib/walkinAvailability.ts";

test("walk-in stays open during the start grace window", () => {
  const now = Date.parse("2026-08-20T11:00:00.000Z");
  const started = new Date(now - 5 * 60 * 1000).toISOString();
  const tooLate = new Date(now - WALKIN_START_GRACE_MS - 1000).toISOString();
  const upcoming = new Date(now + 10 * 60 * 1000).toISOString();
  assert.equal(walkinStartIsOpen(started, now), true);
  assert.equal(walkinStartIsOpen(tooLate, now), false);
  assert.equal(walkinStartIsOpen(upcoming, now), true);
  assert.equal(walkinStartIsOpen(null, now), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCalendarRowsByLocationScope,
  buildSgtCalendarWindow,
  getSgtWeekStartDate,
  normalizeCalendarRpcRows,
} from "../../src/lib/appointment-calendar.ts";

type Row = {
  appointment_id: string;
  location_id: string;
  starts_at: string;
  created_at: string;
  status: string;
};

test("TS contract: normalizes appointment_id to id", () => {
  const rows: Row[] = [
    {
      appointment_id: "apt-1",
      location_id: "loc-a",
      starts_at: "2026-08-17T01:00:00.000Z",
      created_at: "2026-08-01T00:00:00.000Z",
      status: "confirmed",
    },
  ];
  const normalized = normalizeCalendarRpcRows(rows);
  assert.equal(normalized[0].id, "apt-1");
  assert.equal((normalized[0] as { appointment_id?: string }).appointment_id, "apt-1");
});

test("App-layer scope: non-global with no accessible locations is forbidden", async () => {
  const result = await aggregateCalendarRowsByLocationScope<Row>({
    requestedLocationId: null,
    accessibleLocationIds: [],
    hasGlobalAccess: false,
    fetchRows: async () => [],
  });
  assert.equal(result.ok, false);
});

test("App-layer scope: non-global single location queries only that location", async () => {
  const called: Array<string | null> = [];
  const result = await aggregateCalendarRowsByLocationScope<Row>({
    requestedLocationId: null,
    accessibleLocationIds: ["loc-a"],
    hasGlobalAccess: false,
    fetchRows: async (locationId) => {
      called.push(locationId);
      return [
        {
          appointment_id: "apt-1",
          location_id: "loc-a",
          starts_at: "2026-08-17T01:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
          status: "confirmed",
        },
      ];
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(called, ["loc-a"]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].location_id, "loc-a");
});

test("App-layer scope: non-global multi-location aggregates only accessibleLocationIds", async () => {
  const called: Array<string | null> = [];
  const result = await aggregateCalendarRowsByLocationScope<Row>({
    requestedLocationId: null,
    accessibleLocationIds: ["loc-a", "loc-b"],
    hasGlobalAccess: false,
    fetchRows: async (locationId) => {
      called.push(locationId);
      if (locationId === "loc-a") {
        return [
          {
            appointment_id: "apt-2",
            location_id: "loc-a",
            starts_at: "2026-08-17T02:00:00.000Z",
            created_at: "2026-08-01T00:00:00.000Z",
            status: "confirmed",
          },
        ];
      }
      if (locationId === "loc-b") {
        return [
          {
            appointment_id: "apt-1",
            location_id: "loc-b",
            starts_at: "2026-08-17T01:00:00.000Z",
            created_at: "2026-08-01T00:00:00.000Z",
            status: "pending",
          },
        ];
      }
      return [];
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(called, ["loc-a", "loc-b"]);
  assert.deepEqual(result.rows.map((row) => row.location_id), ["loc-b", "loc-a"]);
});

test("App-layer scope: non-global aggregation rejects inaccessible rows", async () => {
  const result = await aggregateCalendarRowsByLocationScope<Row>({
    requestedLocationId: null,
    accessibleLocationIds: ["loc-a"],
    hasGlobalAccess: false,
    fetchRows: async () => [
      {
        appointment_id: "apt-1",
        location_id: "loc-z",
        starts_at: "2026-08-17T01:00:00.000Z",
        created_at: "2026-08-01T00:00:00.000Z",
        status: "pending",
      },
    ],
  });
  assert.equal(result.ok, false);
});

test("App-layer scope: global access with no requested location queries whole studio once", async () => {
  const called: Array<string | null> = [];
  const result = await aggregateCalendarRowsByLocationScope<Row>({
    requestedLocationId: null,
    accessibleLocationIds: ["loc-a"],
    hasGlobalAccess: true,
    fetchRows: async (locationId) => {
      called.push(locationId);
      return [
        {
          appointment_id: "apt-1",
          location_id: "loc-a",
          starts_at: "2026-08-17T01:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
          status: "confirmed",
        },
        {
          appointment_id: "apt-2",
          location_id: "loc-z",
          starts_at: "2026-08-17T02:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
          status: "confirmed",
        },
      ];
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(called, [null]);
  assert.equal(result.rows.length, 2);
});

test("Date: Monday anchor keeps same Monday-Sunday week", () => {
  const window = buildSgtCalendarWindow("week", "2026-08-17");
  assert.deepEqual(window.dayKeys, [
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ]);
});

test("Date: Sunday anchor maps to current week Monday-Sunday", () => {
  const window = buildSgtCalendarWindow("week", "2026-08-23");
  assert.deepEqual(window.dayKeys, [
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ]);
});

test("Date: cross-month week window is correct", () => {
  const window = buildSgtCalendarWindow("week", "2026-08-01");
  assert.deepEqual(window.dayKeys, [
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02",
  ]);
});

test("Date: cross-year week window is correct", () => {
  const weekStart = getSgtWeekStartDate("2027-01-01");
  assert.ok(weekStart);
  const window = buildSgtCalendarWindow("week", "2027-01-01");
  assert.deepEqual(window.dayKeys, [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
});

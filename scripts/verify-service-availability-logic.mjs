/**
 * Unified availability regression checks (resolver-level + helpers).
 * Run: node scripts/verify-service-availability-logic.mjs
 */
import assert from "node:assert/strict";

import {
  firstQueryError,
  getOccupiedWindowMs,
  hasAnyOverlapMs,
  isSameSgtDate,
  isDateWithinEffectiveRange,
  isEmployeeBookableEmployment,
  isFullyCoveredByIntervalsMs,
  isFullyCoveredByTimeIntervals,
  resolveUnifiedAvailabilityFromSnapshot,
  toSeconds,
} from "../src/lib/service-availability-logic.mjs";

const slotStart = Date.parse("2026-08-12T09:00:00+08:00");
const slotEnd = Date.parse("2026-08-12T11:00:00+08:00");

function buildBaseSnapshot(overrides = {}) {
  const occupiedWindow = getOccupiedWindowMs(slotStart, slotEnd, 15, 10);
  return {
    serviceLocation: { is_enabled: true },
    studioService: { is_active: true },
    location: { is_active: true },
    locationHours: [
      { is_closed: false, opens_at: "08:45:00", closes_at: "11:10:00" },
    ],
    locationAssignments: [{ employee_id: "emp-a" }],
    serviceEmployees: [{ employee_id: "emp-a" }],
    workingHours: [
      {
        employee_id: "emp-a",
        starts_at: "08:45:00",
        ends_at: "11:10:00",
        effective_from: null,
        effective_until: null,
      },
    ],
    exceptions: [],
    employeesLookup: new Map([["emp-a", { is_active: true, employment_status: "active" }]]),
    startDateYmd: "2026-08-12",
    occupiedWindow,
    occupiedStartSeconds: toSeconds("08:45"),
    occupiedEndSeconds: toSeconds("11:10"),
    ...overrides,
  };
}

// prep/buffer expansion
assert.deepEqual(getOccupiedWindowMs(slotStart, slotEnd, 15, 10), {
  startMs: Date.parse("2026-08-12T08:45:00+08:00"),
  endMs: Date.parse("2026-08-12T11:10:00+08:00"),
});

// prep/buffer cross-day occupied window should be detectable as invalid for resolver caller
{
  const crossDayWindow = getOccupiedWindowMs(
    Date.parse("2026-08-12T00:10:00+08:00"),
    Date.parse("2026-08-12T01:00:00+08:00"),
    30,
    0,
  );
  assert.equal(isSameSgtDate(crossDayWindow.startMs, crossDayWindow.endMs), false);
}

// helper: adjacent time intervals should count as full coverage
assert.equal(
  isFullyCoveredByTimeIntervals(
    [
      { startsAt: "09:00:00", endsAt: "12:00:00" },
      { startsAt: "12:00:00", endsAt: "18:00:00" },
    ],
    toSeconds("10:00"),
    toSeconds("16:00"),
  ),
  true,
);

// service disabled by service_locations.is_enabled=false
{
  const result = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({ serviceLocation: { is_enabled: false } }),
  );
  assert.equal(result.serviceEnabledAtLocation, false);
  assert.equal(result.candidates[0]?.isAvailable, false);
}

// service-location relation missing should be disabled
{
  const result = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({ serviceLocation: null }),
  );
  assert.equal(result.serviceEnabledAtLocation, false);
  assert.equal(result.candidates[0]?.isAvailable, false);
}

// location inactive should be disabled
{
  const result = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({ location: { is_active: false } }),
  );
  assert.equal(result.serviceEnabledAtLocation, false);
  assert.equal(result.candidates[0]?.isAvailable, false);
}

// contract: studio_services.is_active=false should disable booking
{
  const result = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({ studioService: { is_active: false } }),
  );
  assert.equal(result.serviceEnabledAtLocation, false);
  assert.equal(result.candidates[0]?.isAvailable, false);
}

// location closed / no hours / non-operating hours
{
  const closed = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({ locationHours: [{ is_closed: true, opens_at: null, closes_at: null }] }),
  );
  assert.equal(closed.withinLocationOperatingHours, false);

  const noHours = resolveUnifiedAvailabilityFromSnapshot(buildBaseSnapshot({ locationHours: [] }));
  assert.equal(noHours.withinLocationOperatingHours, false);

  const nonOperating = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      locationHours: [{ is_closed: false, opens_at: "10:00:00", closes_at: "20:00:00" }],
    }),
  );
  assert.equal(nonOperating.withinLocationOperatingHours, false);
}

// adjacent working-hour segments should allow booking
{
  const result = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      workingHours: [
        {
          employee_id: "emp-a",
          starts_at: "08:45:00",
          ends_at: "10:00:00",
          effective_from: null,
          effective_until: null,
        },
        {
          employee_id: "emp-a",
          starts_at: "10:00:00",
          ends_at: "11:10:00",
          effective_from: null,
          effective_until: null,
        },
      ],
    }),
  );
  assert.equal(result.candidates[0]?.withinWorkingHours, true);
  assert.equal(result.candidates[0]?.isAvailable, true);
}

// working-hours effective range: future / expired / boundary date
{
  const future = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      workingHours: [{
        employee_id: "emp-a",
        starts_at: "08:45:00",
        ends_at: "11:10:00",
        effective_from: "2026-08-13",
        effective_until: null,
      }],
    }),
  );
  assert.equal(future.candidates[0]?.withinWorkingHours, false);

  const expired = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      workingHours: [{
        employee_id: "emp-a",
        starts_at: "08:45:00",
        ends_at: "11:10:00",
        effective_from: null,
        effective_until: "2026-08-11",
      }],
    }),
  );
  assert.equal(expired.candidates[0]?.withinWorkingHours, false);

  const boundary = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      workingHours: [{
        employee_id: "emp-a",
        starts_at: "08:45:00",
        ends_at: "11:10:00",
        effective_from: "2026-08-12",
        effective_until: "2026-08-12",
      }],
    }),
  );
  assert.equal(boundary.candidates[0]?.withinWorkingHours, true);
}

// available full/partial coverage and unavailable precedence
{
  const partialAvailable = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      workingHours: [],
      exceptions: [{
        employee_id: "emp-a",
        exception_type: "available",
        starts_at: "2026-08-12T09:30:00+08:00",
        ends_at: "2026-08-12T10:30:00+08:00",
      }],
    }),
  );
  assert.equal(partialAvailable.candidates[0]?.isAvailable, false);

  const fullAvailable = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      workingHours: [],
      exceptions: [
        {
          employee_id: "emp-a",
          exception_type: "available",
          starts_at: "2026-08-12T08:45:00+08:00",
          ends_at: "2026-08-12T10:00:00+08:00",
        },
        {
          employee_id: "emp-a",
          exception_type: "available",
          starts_at: "2026-08-12T10:00:00+08:00",
          ends_at: "2026-08-12T11:10:00+08:00",
        },
      ],
    }),
  );
  assert.equal(fullAvailable.candidates[0]?.isAvailable, true);

  const unavailableWins = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      exceptions: [
        {
          employee_id: "emp-a",
          exception_type: "available",
          starts_at: "2026-08-12T08:45:00+08:00",
          ends_at: "2026-08-12T11:10:00+08:00",
        },
        {
          employee_id: "emp-a",
          exception_type: "unavailable",
          starts_at: "2026-08-12T11:00:00+08:00",
          ends_at: "2026-08-12T11:30:00+08:00",
        },
      ],
    }),
  );
  assert.equal(unavailableWins.candidates[0]?.isAvailable, false);
}

// inactive employee should not be bookable even if employment_status=active
{
  const result = resolveUnifiedAvailabilityFromSnapshot(
    buildBaseSnapshot({
      employeesLookup: new Map([["emp-a", { is_active: false, employment_status: "active" }]]),
    }),
  );
  assert.equal(result.candidates[0]?.isAvailable, false);
}

// raw helper regressions
assert.equal(
  isFullyCoveredByIntervalsMs(slotStart, slotEnd, [
    {
      startMs: Date.parse("2026-08-12T10:00:00+08:00"),
      endMs: Date.parse("2026-08-12T10:30:00+08:00"),
    },
  ]),
  false,
);
assert.equal(
  isFullyCoveredByIntervalsMs(slotStart, slotEnd, [
    {
      startMs: Date.parse("2026-08-12T09:00:00+08:00"),
      endMs: Date.parse("2026-08-12T10:00:00+08:00"),
    },
    {
      startMs: Date.parse("2026-08-12T10:00:00+08:00"),
      endMs: Date.parse("2026-08-12T11:00:00+08:00"),
    },
  ]),
  true,
);
assert.equal(
  hasAnyOverlapMs(
    slotStart,
    slotEnd,
    Date.parse("2026-08-12T10:50:00+08:00"),
    Date.parse("2026-08-12T11:10:00+08:00"),
  ),
  true,
);
assert.equal(isDateWithinEffectiveRange("2026-08-12", "2026-08-13", null), false);
assert.equal(isDateWithinEffectiveRange("2026-08-12", null, "2026-08-11"), false);
assert.equal(isDateWithinEffectiveRange("2026-08-12", "2026-08-01", "2026-08-31"), true);
assert.equal(isEmployeeBookableEmployment(false, "active"), false);
assert.equal(isEmployeeBookableEmployment(true, "inactive"), false);
assert.equal(isEmployeeBookableEmployment(true, "active"), true);

// query error extraction should expose every query name path
for (const queryName of [
  "service_locations",
  "studio_services",
  "locations",
  "employee_locations",
  "service_employees",
  "employee_working_hours",
  "employee_availability_exceptions",
  "location_operating_hours",
  "employees",
]) {
  assert.deepEqual(
    firstQueryError([
      { name: "ok", error: null },
      { name: queryName, error: { message: `${queryName} failed` } },
    ]),
    { query: queryName, message: `${queryName} failed` },
  );
}

console.log("verify-service-availability-logic: ok");

const ACTIVE_EMPLOYMENT_STATUSES = new Set(["active", "probation"]);
const SGT_TIME_ZONE = "Asia/Singapore";

function normalizeTimeToken(token) {
  const text = String(token ?? "").trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  const ss = parts.length === 3 ? Number(parts[2]) : 0;
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || !Number.isInteger(ss)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

export function toSeconds(value) {
  return normalizeTimeToken(value);
}

export function isWithinAnyTimeInterval(intervals, startSeconds, endSeconds) {
  if (!Array.isArray(intervals)) return false;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return false;
  return intervals.some((interval) => {
    const startsAt = toSeconds(interval.startsAt);
    const endsAt = toSeconds(interval.endsAt);
    if (startsAt == null || endsAt == null) return false;
    return startsAt <= startSeconds && endsAt >= endSeconds;
  });
}

export function isFullyCoveredByTimeIntervals(intervals, startSeconds, endSeconds) {
  if (!Array.isArray(intervals)) return false;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return false;
  const normalized = intervals
    .map((interval) => ({
      startSeconds: toSeconds(interval.startsAt),
      endSeconds: toSeconds(interval.endsAt),
    }))
    .filter((interval) => interval.startSeconds != null && interval.endSeconds != null && interval.endSeconds > interval.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  if (normalized.length === 0) return false;

  let cursor = startSeconds;
  for (const interval of normalized) {
    if (interval.endSeconds <= cursor) continue;
    if (interval.startSeconds > cursor) return false;
    cursor = Math.max(cursor, interval.endSeconds);
    if (cursor >= endSeconds) return true;
  }
  return false;
}

export function hasAnyOverlapMs(targetStartMs, targetEndMs, startMs, endMs) {
  return startMs < targetEndMs && endMs > targetStartMs;
}

export function isFullyCoveredByIntervalsMs(targetStartMs, targetEndMs, intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return false;
  const normalized = intervals
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (normalized.length === 0) return false;

  let cursor = targetStartMs;
  for (const interval of normalized) {
    if (interval.endMs <= cursor) continue;
    if (interval.startMs > cursor) return false;
    cursor = Math.max(cursor, interval.endMs);
    if (cursor >= targetEndMs) return true;
  }
  return false;
}

export function isEmployeeBookableEmployment(isActive, employmentStatus) {
  if (!isActive) return false;
  return ACTIVE_EMPLOYMENT_STATUSES.has(String(employmentStatus ?? "").toLowerCase());
}

export function isDateWithinEffectiveRange(targetYmd, effectiveFrom, effectiveUntil) {
  const date = String(targetYmd ?? "").trim();
  if (!date) return false;
  const from = String(effectiveFrom ?? "").trim();
  const until = String(effectiveUntil ?? "").trim();

  if (from && date < from) return false;
  if (until && date > until) return false;
  return true;
}

export function getOccupiedWindowMs(startMs, endMs, prepMinutes, bufferMinutes) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const prepMs = Math.max(0, Number(prepMinutes ?? 0)) * 60_000;
  const bufferMs = Math.max(0, Number(bufferMinutes ?? 0)) * 60_000;
  return {
    startMs: startMs - prepMs,
    endMs: endMs + bufferMs,
  };
}

export function isSameSgtDate(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  const toYmd = (ms) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: SGT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  };
  const startYmd = toYmd(startMs);
  const endYmd = toYmd(endMs);
  return startYmd != null && startYmd === endYmd;
}

export function firstQueryError(entries) {
  for (const entry of entries) {
    if (entry?.error) {
      return {
        query: String(entry.name ?? "unknown"),
        message: String(entry.error.message ?? "Database query failed."),
      };
    }
  }
  return null;
}

export function evaluateAvailabilityCandidates(params) {
  const {
    employeeIds,
    assignedEmployees,
    eligibleEmployees,
    employeesLookup,
    workingByEmployee,
    exceptionByEmployee,
    serviceEnabledAtLocation,
    withinLocationOperatingHours,
    occupiedWindow,
    occupiedStartSeconds,
    occupiedEndSeconds,
  } = params;

  return [...employeeIds]
    .sort()
    .map((employeeId) => {
      const hasLocationAssignment = assignedEmployees.has(employeeId);
      const hasServiceEligibility = eligibleEmployees.has(employeeId);
      const employeeMeta = employeesLookup.get(employeeId);
      const isBookableEmployee = isEmployeeBookableEmployment(
        Boolean(employeeMeta?.is_active),
        employeeMeta?.employment_status,
      );
      const withinWorkingHours = isFullyCoveredByTimeIntervals(
        (workingByEmployee.get(employeeId) ?? []).map((interval) => ({
          startsAt: interval.starts_at,
          endsAt: interval.ends_at,
        })),
        occupiedStartSeconds,
        occupiedEndSeconds,
      );

      const employeeExceptions = exceptionByEmployee.get(employeeId) ?? [];
      const unavailableIntervals = employeeExceptions.filter(
        (exception) => exception.exception_type === "unavailable",
      );
      const availableIntervals = employeeExceptions.filter(
        (exception) => exception.exception_type === "available",
      );
      const hasUnavailableException = unavailableIntervals.some((interval) =>
        hasAnyOverlapMs(occupiedWindow.startMs, occupiedWindow.endMs, interval.startMs, interval.endMs),
      );
      const hasAvailableException = availableIntervals.length > 0;
      const availableExceptionCoversRange = isFullyCoveredByIntervalsMs(
        occupiedWindow.startMs,
        occupiedWindow.endMs,
        availableIntervals,
      );
      const timeAvailable = !hasUnavailableException && (withinWorkingHours || availableExceptionCoversRange);

      return {
        employeeId,
        hasLocationAssignment,
        hasServiceEligibility,
        withinLocationOperatingHours,
        withinWorkingHours,
        hasAvailableException,
        hasUnavailableException,
        isAvailable:
          serviceEnabledAtLocation
          && isBookableEmployee
          && hasLocationAssignment
          && hasServiceEligibility
          && withinLocationOperatingHours
          && timeAvailable,
      };
    });
}

export function resolveUnifiedAvailabilityFromSnapshot(params) {
  const {
    serviceLocation,
    studioService,
    location,
    locationHours,
    locationAssignments,
    serviceEmployees,
    workingHours,
    exceptions,
    employeesLookup,
    startDateYmd,
    occupiedWindow,
    occupiedStartSeconds,
    occupiedEndSeconds,
  } = params;

  const serviceEnabledAtLocation = Boolean(
    serviceLocation?.is_enabled && studioService?.is_active && location?.is_active,
  );
  const locationHourIntervals = (locationHours ?? [])
    .filter((row) => !row.is_closed && row.opens_at != null && row.closes_at != null)
    .map((row) => ({ startsAt: row.opens_at, endsAt: row.closes_at }));
  const hasClosedMarker = (locationHours ?? []).some((row) => row.is_closed);
  const withinLocationOperatingHours = !hasClosedMarker
    && isFullyCoveredByTimeIntervals(locationHourIntervals, occupiedStartSeconds, occupiedEndSeconds);

  const assignedEmployees = new Set((locationAssignments ?? []).map((row) => row.employee_id));
  const eligibleEmployees = new Set((serviceEmployees ?? []).map((row) => row.employee_id));
  const allEmployeeIds = new Set([...assignedEmployees, ...eligibleEmployees]);

  const workingByEmployee = new Map();
  for (const row of workingHours ?? []) {
    if (!isDateWithinEffectiveRange(startDateYmd, row.effective_from, row.effective_until)) continue;
    const existing = workingByEmployee.get(row.employee_id) ?? [];
    existing.push({ starts_at: row.starts_at, ends_at: row.ends_at });
    workingByEmployee.set(row.employee_id, existing);
  }

  const exceptionByEmployee = new Map();
  for (const row of exceptions ?? []) {
    const startMs = new Date(row.starts_at).getTime();
    const endMs = new Date(row.ends_at).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const existing = exceptionByEmployee.get(row.employee_id) ?? [];
    existing.push({
      exception_type: row.exception_type,
      startMs,
      endMs,
    });
    exceptionByEmployee.set(row.employee_id, existing);
  }

  const candidates = evaluateAvailabilityCandidates({
    employeeIds: allEmployeeIds,
    assignedEmployees,
    eligibleEmployees,
    employeesLookup,
    workingByEmployee,
    exceptionByEmployee,
    serviceEnabledAtLocation,
    withinLocationOperatingHours,
    occupiedWindow,
    occupiedStartSeconds,
    occupiedEndSeconds,
  });

  return {
    serviceEnabledAtLocation,
    withinLocationOperatingHours,
    candidates,
  };
}

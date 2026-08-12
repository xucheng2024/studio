import { dayRangeEndExclusiveIso, dayRangeStartIso, localISODate } from "./date.ts";

export type CalendarView = "day" | "week";

export type CalendarRpcRowBase = {
  appointment_id: string;
  location_id: string;
  starts_at: string;
  created_at: string;
};

export type CalendarNormalizedRow<TRow extends CalendarRpcRowBase> = Omit<TRow, "appointment_id"> & {
  id: string;
};

export function normalizeCalendarRpcRows<TRow extends CalendarRpcRowBase>(
  rows: TRow[],
): Array<CalendarNormalizedRow<TRow>> {
  return rows.map((row) => ({
    ...row,
    id: row.appointment_id,
  }));
}

export function sortCalendarRows<TRow extends { id: string; starts_at: string; created_at: string }>(rows: TRow[]) {
  return [...rows].sort((left, right) => {
    const starts = left.starts_at.localeCompare(right.starts_at);
    if (starts !== 0) return starts;
    const created = left.created_at.localeCompare(right.created_at);
    if (created !== 0) return created;
    return left.id.localeCompare(right.id);
  });
}

export function getSgtWeekStartDate(dateText: string) {
  const [yearText, monthText, dayText] = dateText.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const seed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(seed.getTime())) return null;

  const mondayBasedWeekday = (seed.getUTCDay() + 6) % 7;
  seed.setUTCDate(seed.getUTCDate() - mondayBasedWeekday);
  return seed;
}

export function buildSgtCalendarWindow(view: CalendarView, anchorDateText: string) {
  if (view === "day") {
    return {
      rangeStartIso: dayRangeStartIso(anchorDateText),
      rangeEndIso: dayRangeEndExclusiveIso(anchorDateText),
      dayKeys: [anchorDateText],
    };
  }

  const weekStart = getSgtWeekStartDate(anchorDateText);
  if (!weekStart) {
    return {
      rangeStartIso: null,
      rangeEndIso: null,
      dayKeys: [] as string[],
    };
  }

  const dayKeys: string[] = [];
  for (let idx = 0; idx < 7; idx += 1) {
    const day = new Date(weekStart.getTime());
    day.setUTCDate(day.getUTCDate() + idx);
    dayKeys.push(localISODate(day));
  }

  return {
    rangeStartIso: dayRangeStartIso(dayKeys[0]),
    rangeEndIso: dayRangeEndExclusiveIso(dayKeys[dayKeys.length - 1]),
    dayKeys,
  };
}

export function resolveCalendarQueryLocationIds(params: {
  requestedLocationId: string | null;
  accessibleLocationIds: string[];
  hasGlobalAccess: boolean;
}): { ok: true; locationIds: Array<string | null> } | { ok: false } {
  if (params.hasGlobalAccess) {
    return {
      ok: true,
      locationIds: [params.requestedLocationId ?? null],
    };
  }

  const uniqueAccessible = [...new Set(params.accessibleLocationIds.filter(Boolean))];
  if (params.requestedLocationId) {
    if (!uniqueAccessible.includes(params.requestedLocationId)) {
      return { ok: false };
    }
    return { ok: true, locationIds: [params.requestedLocationId] };
  }

  if (uniqueAccessible.length === 0) {
    return { ok: false };
  }

  return { ok: true, locationIds: uniqueAccessible };
}

export async function aggregateCalendarRowsByLocationScope<TRow extends CalendarRpcRowBase>(params: {
  requestedLocationId: string | null;
  accessibleLocationIds: string[];
  hasGlobalAccess: boolean;
  fetchRows: (locationId: string | null) => Promise<TRow[]>;
}): Promise<{ ok: true; rows: Array<CalendarNormalizedRow<TRow>> } | { ok: false; reason: "forbidden" }> {
  const resolved = resolveCalendarQueryLocationIds({
    requestedLocationId: params.requestedLocationId,
    accessibleLocationIds: params.accessibleLocationIds,
    hasGlobalAccess: params.hasGlobalAccess,
  });
  if (!resolved.ok) return { ok: false, reason: "forbidden" };

  const allRows: Array<CalendarNormalizedRow<TRow>> = [];
  for (const locationId of resolved.locationIds) {
    const rows = await params.fetchRows(locationId);
    allRows.push(...normalizeCalendarRpcRows(rows));
  }

  const sorted = sortCalendarRows(allRows);

  if (!params.hasGlobalAccess) {
    const allowed = new Set(params.accessibleLocationIds);
    const hasViolation = sorted.some((row) => !allowed.has(row.location_id));
    if (hasViolation) {
      return { ok: false, reason: "forbidden" };
    }
  }

  return { ok: true, rows: sorted };
}

export type WeekHoursInterval = { start: string; end: string };
export type WeekDayHours = { weekday: number; intervals: WeekHoursInterval[] };

export const WEEKDAY_LABELS = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
] as const;

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function sliceHm(value: string | null | undefined): string {
  return String(value ?? "").slice(0, 5);
}

export function emptyWeekHours(): WeekDayHours[] {
  return WEEKDAYS.map((weekday) => ({ weekday, intervals: [] }));
}

export function serializeWeekDayHours(intervals: WeekHoursInterval[]): string {
  return intervals
    .filter((interval) => interval.start && interval.end)
    .map((interval) => `${interval.start}-${interval.end}`)
    .join(", ");
}

export function intervalsKey(intervals: WeekHoursInterval[]): string {
  return serializeWeekDayHours(intervals);
}

export function workingHoursToWeekDays(
  rows: Array<{ weekday: number; starts_at: string; ends_at: string }>,
): WeekDayHours[] {
  const days = emptyWeekHours();
  for (const row of rows) {
    const day = days[row.weekday];
    if (!day) continue;
    const start = sliceHm(row.starts_at);
    const end = sliceHm(row.ends_at);
    if (!start || !end) continue;
    day.intervals.push({ start, end });
  }
  return days;
}

export function operatingHoursToWeekDays(
  rows: Array<{ weekday: number; is_closed: boolean; opens_at: string | null; closes_at: string | null }>,
): WeekDayHours[] {
  const days = emptyWeekHours();
  for (const row of rows) {
    const day = days[row.weekday];
    if (!day || row.is_closed) continue;
    const start = sliceHm(row.opens_at);
    const end = sliceHm(row.closes_at);
    if (!start || !end) continue;
    day.intervals.push({ start, end });
  }
  return days;
}

export function formatWeekHoursSummary(days: WeekDayHours[]): string {
  const working = days.filter((day) => day.intervals.length > 0);
  if (working.length === 0) return "Not set";

  const groups: Array<{ start: number; end: number; label: string }> = [];
  for (const day of working) {
    const label = serializeWeekDayHours(day.intervals);
    const last = groups[groups.length - 1];
    if (last && last.end === day.weekday - 1 && last.label === label) {
      last.end = day.weekday;
      continue;
    }
    groups.push({ start: day.weekday, end: day.weekday, label });
  }

  return groups
    .map((group) => {
      const start = WEEKDAY_LABELS[group.start]?.short ?? "";
      const end = WEEKDAY_LABELS[group.end]?.short ?? "";
      const dayLabel = group.start === group.end ? start : `${start}–${end}`;
      return `${dayLabel} ${group.label}`;
    })
    .join(" · ");
}

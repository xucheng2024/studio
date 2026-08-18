"use client";

import { ui } from "@/lib/ui";
import {
  WEEKDAY_LABELS,
  serializeWeekDayHours,
  type WeekDayHours,
  type WeekHoursInterval,
} from "@/lib/week-hours";

function updateDay(days: WeekDayHours[], weekday: number, intervals: WeekHoursInterval[]): WeekDayHours[] {
  return days.map((day) => (day.weekday === weekday ? { ...day, intervals } : day));
}

function intervalAt(intervals: WeekHoursInterval[], index: number): WeekHoursInterval {
  return intervals[index] ?? { start: "", end: "" };
}

export function WeekHoursEditor({
  days,
  onChange,
  namePrefix = "weekday_",
}: {
  days: WeekDayHours[];
  onChange: (next: WeekDayHours[]) => void;
  namePrefix?: string;
}) {
  return (
    <div className="grid gap-2">
      {WEEKDAY_LABELS.map((weekday) => {
        const day = days[weekday.value] ?? { weekday: weekday.value, intervals: [] };
        const first = intervalAt(day.intervals, 0);
        const second = intervalAt(day.intervals, 1);
        const hasSecond = day.intervals.length > 1;

        return (
          <div
            key={weekday.value}
            className="grid gap-2 rounded-xl border border-stone-200/80 p-2.5 dark:border-stone-800/80 sm:grid-cols-[5.5rem_1fr_auto] sm:items-center"
          >
            <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{weekday.label}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <input
                type="time"
                name={`${namePrefix}${weekday.value}_start`}
                aria-label={`${weekday.label} start`}
                value={first.start}
                onChange={(event) => {
                  const next = { start: event.target.value, end: first.end };
                  const rest = hasSecond ? [second] : [];
                  onChange(updateDay(days, weekday.value, next.start || next.end || rest.length ? [next, ...rest] : []));
                }}
                className={`${ui.input} min-w-0 max-w-[9rem]`}
              />
              <span className={`text-xs ${ui.muted}`}>to</span>
              <input
                type="time"
                name={`${namePrefix}${weekday.value}_end`}
                aria-label={`${weekday.label} end`}
                value={first.end}
                onChange={(event) => {
                  const next = { start: first.start, end: event.target.value };
                  const rest = hasSecond ? [second] : [];
                  onChange(updateDay(days, weekday.value, next.start || next.end || rest.length ? [next, ...rest] : []));
                }}
                className={`${ui.input} min-w-0 max-w-[9rem]`}
              />
              {hasSecond ? (
                <>
                  <span className={`text-xs ${ui.muted}`}>then</span>
                  <input
                    type="time"
                    name={`${namePrefix}${weekday.value}_start2`}
                    aria-label={`${weekday.label} start 2`}
                    value={second.start}
                    onChange={(event) => {
                      onChange(updateDay(days, weekday.value, [first, { start: event.target.value, end: second.end }]));
                    }}
                    className={`${ui.input} min-w-0 max-w-[9rem]`}
                  />
                  <span className={`text-xs ${ui.muted}`}>to</span>
                  <input
                    type="time"
                    name={`${namePrefix}${weekday.value}_end2`}
                    aria-label={`${weekday.label} end 2`}
                    value={second.end}
                    onChange={(event) => {
                      onChange(updateDay(days, weekday.value, [first, { start: second.start, end: event.target.value }]));
                    }}
                    className={`${ui.input} min-w-0 max-w-[9rem]`}
                  />
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {hasSecond ? (
                <button
                  type="button"
                  className={ui.btnGhost}
                  onClick={() => onChange(updateDay(days, weekday.value, first.start || first.end ? [first] : []))}
                >
                  Remove break
                </button>
              ) : (
                <button
                  type="button"
                  className={ui.btnGhost}
                  onClick={() => onChange(updateDay(days, weekday.value, [first.start || first.end ? first : { start: "", end: "" }, { start: "", end: "" }]))}
                >
                  Add break
                </button>
              )}
              <button
                type="button"
                className={ui.btnGhost}
                onClick={() => {
                  const source = day.intervals.filter((interval) => interval.start && interval.end);
                  if (source.length === 0) return;
                  onChange(
                    days.map((item) =>
                      item.weekday >= 1 && item.weekday <= 5 ? { ...item, intervals: source.map((interval) => ({ ...interval })) } : item,
                    ),
                  );
                }}
              >
                Use for weekdays
              </button>
            </div>
            <input type="hidden" name={`${namePrefix}${weekday.value}`} value={serializeWeekDayHours(day.intervals)} />
          </div>
        );
      })}
    </div>
  );
}

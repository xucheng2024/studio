"use client";

import { useMemo, useState } from "react";
import { copyEmployeeWorkingHoursToStaffAction, setEmployeeWorkingHoursWeekAction } from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { WeekHoursEditor } from "@/components/dashboard/WeekHoursEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { ui } from "@/lib/ui";
import {
  emptyWeekHours,
  formatWeekHoursSummary,
  serializeWeekDayHours,
  WEEKDAYS,
  type WeekDayHours,
} from "@/lib/week-hours";

type StaffOption = { id: string; display_name: string; days: WeekDayHours[] };

function WeekHiddenFields({ days, namePrefix = "weekday_" }: { days: WeekDayHours[]; namePrefix?: string }) {
  return (
    <>
      {WEEKDAYS.map((weekday) => (
        <input
          key={weekday}
          type="hidden"
          name={`${namePrefix}${weekday}`}
          value={serializeWeekDayHours(days[weekday]?.intervals ?? [])}
        />
      ))}
    </>
  );
}

export function StaffWorkingHoursSetup({
  studioId,
  locationId,
  employeeId,
  defaultDays,
  locationDays,
  otherEmployees,
}: {
  studioId: string;
  locationId: string;
  employeeId: string;
  defaultDays: WeekDayHours[];
  locationDays: WeekDayHours[];
  otherEmployees: StaffOption[];
}) {
  const [days, setDays] = useState<WeekDayHours[]>(defaultDays);
  const [copySourceId, setCopySourceId] = useState("");
  const locationSummary = useMemo(() => formatWeekHoursSummary(locationDays), [locationDays]);
  const hasLocationHours = locationSummary !== "Not set";

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <button
          type="button"
          className={ui.btnSecondarySm}
          disabled={!hasLocationHours}
          onClick={() => setDays(locationDays.map((day) => ({ weekday: day.weekday, intervals: day.intervals.map((interval) => ({ ...interval })) })))}
        >
          Copy location hours
        </button>
        {otherEmployees.length > 0 ? (
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={ui.label}>Copy from staff</span>
            <select
              className={ui.select}
              value={copySourceId}
              onChange={(event) => {
                const nextId = event.target.value;
                setCopySourceId(nextId);
                const source = otherEmployees.find((employee) => employee.id === nextId);
                if (!source) return;
                setDays(source.days.map((day) => ({ weekday: day.weekday, intervals: day.intervals.map((interval) => ({ ...interval })) })));
              }}
            >
              <option value="">Choose an employee</option>
              {otherEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.display_name} · {formatWeekHoursSummary(employee.days)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className={ui.btnSecondarySm}
          onClick={() => {
            const monday = days[1]?.intervals.filter((interval) => interval.start && interval.end) ?? [];
            const fallback = days.find((day) => day.intervals.some((interval) => interval.start && interval.end))?.intervals ?? [];
            const source = monday.length > 0 ? monday : fallback;
            if (source.length === 0) return;
            setDays(
              days.map((day) =>
                day.weekday >= 1 && day.weekday <= 5
                  ? { ...day, intervals: source.map((interval) => ({ ...interval })) }
                  : day,
              ),
            );
          }}
        >
          Apply to Mon–Fri
        </button>
        <button type="button" className={ui.btnGhost} onClick={() => setDays(emptyWeekHours())}>
          Clear week
        </button>
      </div>
      {!hasLocationHours ? (
        <p className={`text-xs ${ui.muted}`}>Set location operating hours first to copy them here.</p>
      ) : (
        <p className={`text-xs ${ui.muted}`}>Location hours: {locationSummary}. Fill the week, then save.</p>
      )}

      <ServerActionToastForm action={setEmployeeWorkingHoursWeekAction} className="grid gap-3">
        <input type="hidden" name="studio_id" value={studioId} />
        <input type="hidden" name="location_id" value={locationId} />
        <input type="hidden" name="employee_id" value={employeeId} />
        <WeekHoursEditor days={days} onChange={setDays} />
        <SubmitButton className={`${ui.btnPrimary} w-full sm:w-fit`} pendingText="Saving...">
          Save working hours
        </SubmitButton>
      </ServerActionToastForm>

      {otherEmployees.length > 0 ? (
        <details className="chevron rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80">
          <summary className="cursor-pointer text-sm font-medium text-stone-900 dark:text-stone-100">
            Copy this week to other staff
          </summary>
          <ServerActionToastForm action={copyEmployeeWorkingHoursToStaffAction} className="mt-3 grid gap-3">
            <input type="hidden" name="studio_id" value={studioId} />
            <input type="hidden" name="location_id" value={locationId} />
            <input type="hidden" name="employee_id" value={employeeId} />
            <WeekHiddenFields days={days} />
            <div className="grid gap-2 sm:grid-cols-2">
              {otherEmployees.map((employee) => (
                <label key={employee.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="target_employee_ids" value={employee.id} />
                  <span className="min-w-0">
                    <span className="block truncate">{employee.display_name}</span>
                    <span className={`block text-xs ${ui.muted}`}>{formatWeekHoursSummary(employee.days)}</span>
                  </span>
                </label>
              ))}
            </div>
            <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-fit`} pendingText="Copying...">
              Copy to selected
            </SubmitButton>
          </ServerActionToastForm>
        </details>
      ) : null}
    </div>
  );
}

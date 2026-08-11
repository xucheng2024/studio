"use server";

import { revalidateDashboardSettings } from "@/lib/revalidatePublic";
import { parseDatetimeLocalAsSgt } from "@/lib/date";
import {
  createEmployeeAvailabilityException,
  deleteEmployeeAvailabilityException,
  setEmployeeWorkingHoursForWeek,
  type ExceptionReasonCategory,
  type ExceptionType,
} from "@/lib/staff-availability";
import { err, ok, parseTimeRangeList, requireUser, type DashboardFormResult } from "./shared";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export async function setEmployeeWorkingHoursWeekAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  if (!studioId || !employeeId || !locationId) return err("Please fill the required fields.");

  const weekPayload: Array<{ weekday: number; intervals: Array<{ starts_at: string; ends_at: string }> }> = [];
  for (const weekday of WEEKDAYS) {
    const ranges = parseTimeRangeList(formData.get(`weekday_${weekday}`));
    if (ranges === null) {
      return err(`Invalid time range for ${WEEKDAY_LABELS[weekday]}. Use HH:MM-HH:MM, comma separated.`);
    }
    weekPayload.push({
      weekday,
      intervals: ranges.map((range) => ({ starts_at: range.start, ends_at: range.end })),
    });
  }

  const { user } = await requireUser();
  const result = await setEmployeeWorkingHoursForWeek({
    userId: user.id,
    studioId,
    employeeId,
    locationId,
    days: weekPayload,
  });
  if (!result.ok) return err(result.message ?? "Could not save working hours.");

  revalidateDashboardSettings("staff-availability");
  return ok("Working hours saved.");
}

export async function createAvailabilityExceptionAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const exceptionType = String(formData.get("exception_type") ?? "").trim() as ExceptionType;
  const reasonCategory = String(formData.get("reason_category") ?? "").trim() as ExceptionReasonCategory;
  const startsAtRaw = String(formData.get("starts_at") ?? "").trim();
  const endsAtRaw = String(formData.get("ends_at") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!studioId || !employeeId || !startsAtRaw || !endsAtRaw) {
    return err("Please fill the required fields.");
  }
  if (exceptionType !== "unavailable" && exceptionType !== "available") {
    return err("Invalid exception type.");
  }
  const startsAt = parseDatetimeLocalAsSgt(startsAtRaw);
  const endsAt = parseDatetimeLocalAsSgt(endsAtRaw);
  if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return err("Invalid start or end time.");
  }
  if (endsAt <= startsAt) return err("End time must be after start time.");

  const { user } = await requireUser();
  const result = await createEmployeeAvailabilityException({
    userId: user.id,
    studioId,
    employeeId,
    exceptionType,
    reasonCategory,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    locationId,
    reason,
  });
  if (!result.ok) return err(result.message ?? "Could not create availability exception.");

  revalidateDashboardSettings("staff-availability");
  return ok("Availability exception added.");
}

export async function deleteAvailabilityExceptionAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const exceptionId = String(formData.get("exception_id") ?? "").trim();
  if (!studioId || !exceptionId) return err("Please fill the required fields.");

  const { user } = await requireUser();
  const result = await deleteEmployeeAvailabilityException({ userId: user.id, studioId, exceptionId });
  if (!result.ok) return err(result.message ?? "Could not remove availability exception.");

  revalidateDashboardSettings("staff-availability");
  return ok("Availability exception removed.");
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

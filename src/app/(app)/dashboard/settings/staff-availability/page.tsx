import {
  createAvailabilityExceptionAction,
  deleteAvailabilityExceptionAction,
} from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { StaffWorkingHoursSetup } from "@/components/dashboard/StaffWorkingHoursSetup";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ToastConfirmForm } from "@/components/ToastConfirmForm";
import { formatLocalDateTime } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import {
  listEmployeeAvailabilityExceptions,
  listLocationOperatingHours,
} from "@/lib/staff-availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";
import {
  emptyWeekHours,
  formatWeekHoursSummary,
  operatingHoursToWeekDays,
  workingHoursToWeekDays,
  type WeekDayHours,
} from "@/lib/week-hours";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string; employee_id?: string }>;
};

function scopedStaffHref(studioId: string, locationId: string, employeeId: string) {
  const params = new URLSearchParams({
    studio_id: studioId,
    location_id: locationId,
    employee_id: employeeId,
  });
  return `/dashboard/settings/staff-availability?${params.toString()}`;
}

export default async function StaffAvailabilityPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } =
    await getDashboardScopeForRoles(
      { userId: user.id, email: user.email, studioId: sp.studio_id ?? null, locationId: sp.location_id ?? null },
      ["owner", "manager"],
    );
  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, studioId);
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .order("name");

  const header = (
    <div>
      <h1 className={ui.h1}>Staff availability</h1>
      <p className={`mt-1 ${ui.muted}`}>Set weekly hours once per location, then copy them to other staff.</p>
    </div>
  );
  const locationFilter = (
    <div className={`${ui.card} flex flex-wrap gap-3`}>
      <DashboardLocationFilter
        locations={locationRows ?? []}
        selectedStudioId={studioId}
        selectedLocationId={selectedLocationId}
        allowAll={false}
        accessibleLocationIds={canViewAllLocations ? (locationRows ?? []).map((l) => l.id) : accessibleLocationIds}
      />
    </div>
  );

  if (!selectedLocationId) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {locationFilter}
        <p className={ui.muted}>Select a location to manage employee working hours.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const [{ data: employeeLocationRows }, { data: hourRows }, hoursResult] = await Promise.all([
    admin
      .from("employee_locations")
      .select("employee_id, employees(id, display_name, employment_status)")
      .eq("studio_id", studioId)
      .eq("location_id", selectedLocationId)
      .eq("is_active", true),
    admin
      .from("employee_working_hours")
      .select("employee_id, weekday, starts_at, ends_at")
      .eq("studio_id", studioId)
      .eq("location_id", selectedLocationId)
      .eq("is_active", true),
    listLocationOperatingHours({
      userId: user.id,
      email: user.email,
      studioId,
      locationId: selectedLocationId,
    }),
  ]);

  type EmployeeOption = { id: string; display_name: string; days: WeekDayHours[] };
  const hoursByEmployee = new Map<string, Array<{ weekday: number; starts_at: string; ends_at: string }>>();
  for (const row of hourRows ?? []) {
    const list = hoursByEmployee.get(row.employee_id) ?? [];
    list.push(row);
    hoursByEmployee.set(row.employee_id, list);
  }

  const employees: EmployeeOption[] = (employeeLocationRows ?? [])
    .map((row) => {
      const employee = (Array.isArray(row.employees) ? row.employees[0] : row.employees) as
        | { id: string; display_name: string; employment_status: string }
        | null;
      return employee && employee.employment_status === "active"
        ? {
            id: employee.id,
            display_name: employee.display_name,
            days: workingHoursToWeekDays(hoursByEmployee.get(employee.id) ?? []),
          }
        : null;
    })
    .filter((e): e is EmployeeOption => e !== null)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const employeeId = sp.employee_id && employees.some((e) => e.id === sp.employee_id) ? sp.employee_id : employees[0]?.id ?? null;
  const selectedEmployee = employees.find((employee) => employee.id === employeeId) ?? null;
  const locationDays = hoursResult.ok ? operatingHoursToWeekDays(hoursResult.hours) : emptyWeekHours();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {header}
      {locationFilter}

      {employees.length === 0 ? (
        <p className={ui.muted}>
          No employees are assigned to this location yet. Assign employees to this location from the Staff page first.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <div className={ui.card}>
            <p className={ui.sectionHeader}>Staff</p>
            <ul className="mt-3 grid gap-1">
              {employees.map((employee) => {
                const selected = employee.id === employeeId;
                return (
                  <li key={employee.id}>
                    <DashboardAppLink
                      href={scopedStaffHref(studioId, selectedLocationId, employee.id)}
                      className={`block rounded-xl px-3 py-2 ${
                        selected
                          ? "bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-100"
                          : "hover:bg-stone-50 dark:hover:bg-stone-800/60"
                      }`}
                    >
                      <span className="block truncate text-sm font-medium">{employee.display_name}</span>
                      <span className={`block truncate text-xs ${ui.muted}`}>{formatWeekHoursSummary(employee.days)}</span>
                    </DashboardAppLink>
                  </li>
                );
              })}
            </ul>
          </div>

          {selectedEmployee ? (
            <EmployeeAvailabilityPanel
              userId={user.id}
              email={user.email}
              studioId={studioId}
              locationId={selectedLocationId}
              employeeId={selectedEmployee.id}
              employeeName={selectedEmployee.display_name}
              defaultDays={selectedEmployee.days}
              locationDays={locationDays}
              otherEmployees={employees.filter((employee) => employee.id !== selectedEmployee.id)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

async function EmployeeAvailabilityPanel(props: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId: string;
  employeeId: string;
  employeeName: string;
  defaultDays: WeekDayHours[];
  locationDays: WeekDayHours[];
  otherEmployees: Array<{ id: string; display_name: string; days: WeekDayHours[] }>;
}) {
  const exceptionsResult = await listEmployeeAvailabilityExceptions({
    userId: props.userId,
    email: props.email,
    studioId: props.studioId,
    employeeId: props.employeeId,
  });
  const exceptions = exceptionsResult.ok ? exceptionsResult.exceptions : [];

  return (
    <div className="flex flex-col gap-4">
      <div className={ui.card}>
        <h2 className={ui.h2}>{props.employeeName}</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>
          Leave a day empty if they do not work. Add a break for split shifts. Copy or apply before saving.
        </p>
        <div className="mt-4">
          <StaffWorkingHoursSetup
            key={props.employeeId}
            studioId={props.studioId}
            locationId={props.locationId}
            employeeId={props.employeeId}
            defaultDays={props.defaultDays}
            locationDays={props.locationDays}
            otherEmployees={props.otherEmployees}
          />
        </div>
      </div>

      <details className={`chevron ${ui.card}`}>
        <summary className="cursor-pointer text-sm font-medium text-stone-900 dark:text-stone-100">
          Availability exceptions
          {exceptions.length > 0 ? ` (${exceptions.length})` : ""}
        </summary>
        <p className={`mt-1 text-xs ${ui.muted}`}>
          Temporary blocked or extra-available time (break, leave, training, meeting, overtime, other). This is
          booking availability only, not a leave/attendance record.
        </p>

        {exceptions.length === 0 ? (
          <p className={`mt-3 text-sm ${ui.muted}`}>No exceptions recorded.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">
            {exceptions.map((exception) => (
              <li key={exception.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {exception.exception_type === "unavailable" ? "Unavailable" : "Extra available"} ·{" "}
                    {exception.reason_category}
                  </span>
                  <span className={`text-xs ${ui.muted}`}>
                    {formatLocalDateTime(exception.starts_at, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {" – "}
                    {formatLocalDateTime(exception.ends_at, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {" (SGT)"}
                  </span>
                  {exception.reason ? <span className={`text-xs ${ui.muted}`}>{exception.reason}</span> : null}
                </div>
                <ToastConfirmForm
                  action={deleteAvailabilityExceptionAction}
                  confirmMessage="Remove this availability exception?"
                  confirmLabel="Remove"
                  pendingLabel="Removing..."
                >
                  <input type="hidden" name="studio_id" value={props.studioId} />
                  <input type="hidden" name="exception_id" value={exception.id} />
                  <button type="submit" className={`${ui.btnDangerSm} px-2`}>
                    Remove
                  </button>
                </ToastConfirmForm>
              </li>
            ))}
          </ul>
        )}

        <details className={`chevron mt-4 border-t border-stone-100 pt-3 dark:border-stone-800`}>
          <summary className="cursor-pointer text-sm font-medium text-stone-900 dark:text-stone-100">
            + Add exception
          </summary>
          <ServerActionToastForm action={createAvailabilityExceptionAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="studio_id" value={props.studioId} />
            <input type="hidden" name="employee_id" value={props.employeeId} />
            <input type="hidden" name="location_id" value={props.locationId} />
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Type</span>
              <select name="exception_type" className={ui.select} defaultValue="unavailable">
                <option value="unavailable">Unavailable</option>
                <option value="available">Extra available</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Reason</span>
              <select name="reason_category" className={ui.select} defaultValue="other">
                <option value="break">Break</option>
                <option value="leave">Leave</option>
                <option value="training">Training</option>
                <option value="meeting">Meeting</option>
                <option value="overtime">Overtime</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Starts at</span>
              <input type="datetime-local" name="starts_at" required className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Ends at</span>
              <input type="datetime-local" name="ends_at" required className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={ui.label}>Note (optional)</span>
              <input name="reason" className={ui.input} />
            </label>
            <SubmitButton className={`${ui.btnPrimarySm} w-full sm:w-fit`} pendingText="Adding...">
              Add exception
            </SubmitButton>
          </ServerActionToastForm>
        </details>
      </details>
    </div>
  );
}

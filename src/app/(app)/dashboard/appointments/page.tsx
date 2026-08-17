import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { AppointmentNotificationOpsPanel } from "@/components/dashboard/AppointmentNotificationOpsPanel";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import {
  cancelSalonAppointmentAction,
  createSalonAppointmentAction,
  rescheduleSalonAppointmentAction,
  transitionSalonAppointmentStatusAction,
} from "@/app/(app)/dashboard/actions";
import {
  formatLocalDate,
  localDateKey,
  localISODate,
  toLocalDateTimeInputValue,
} from "@/lib/date";
import { buildSgtCalendarWindow } from "@/lib/appointment-calendar";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { listAppointmentsForCalendar, type AppointmentCalendarRow } from "@/lib/salon-appointments";
import { hasStudioGlobalLocationAccess, hasStudioRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { LocalTime } from "@/components/ui/LocalTime";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CalendarDays, CalendarX2 } from "lucide-react";

type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    view?: "day" | "week";
    date?: string;
    employee_id?: string;
    service_id?: string;
    status?: "all" | AppointmentStatus;
  }>;
};

const STATUS_OPTIONS: AppointmentStatus[] = [
  "pending",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
];

function getStatusLabel(status: AppointmentStatus) {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "checked_in":
      return "Checked-in";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "no_show":
      return "No-show";
  }
}

function getStatusBadge(status: AppointmentStatus) {
  if (status === "completed") return ui.badge;
  if (status === "cancelled" || status === "no_show") return ui.badgeRed;
  if (status === "pending") return ui.badgeAmber;
  return ui.badgeNeutral;
}


function buildTransitionKey(appointment: AppointmentCalendarRow, toStatus: string) {
  return `apt03-transition:${appointment.id}:${appointment.updated_at}:${toStatus}`;
}

function getManageTransitions(status: AppointmentStatus) {
  switch (status) {
    case "pending":
      return ["confirmed", "cancelled", "no_show"] as const;
    case "confirmed":
      return ["checked_in", "cancelled", "no_show"] as const;
    case "checked_in":
      return ["in_progress", "cancelled", "no_show"] as const;
    case "in_progress":
      return ["completed", "cancelled", "no_show"] as const;
    default:
      return [] as const;
  }
}

function getInstructorTransitions(status: AppointmentStatus) {
  switch (status) {
    case "confirmed":
      return ["checked_in"] as const;
    case "checked_in":
      return ["in_progress"] as const;
    case "in_progress":
      return ["completed"] as const;
    default:
      return [] as const;
  }
}

function groupByDate(appointments: AppointmentCalendarRow[]) {
  const grouped = new Map<string, AppointmentCalendarRow[]>();
  for (const appointment of appointments) {
    const key = localDateKey(appointment.starts_at);
    const list = grouped.get(key) ?? [];
    list.push(appointment);
    grouped.set(key, list);
  }
  return grouped;
}

function AppointmentCard(props: {
  appointment: AppointmentCalendarRow;
  studioId: string;
  canManage: boolean;
  isInstructorOnly: boolean;
  locations: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; display_name: string }>;
}) {
  const appointment = props.appointment;
  const transitions = props.canManage
    ? getManageTransitions(appointment.status as AppointmentStatus)
    : props.isInstructorOnly
      ? getInstructorTransitions(appointment.status as AppointmentStatus)
      : [];
  const transitionSet = new Set<string>(transitions as readonly string[]);
  const canReschedule =
    props.canManage && ["pending", "confirmed"].includes(appointment.status);

  return (
    <article className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {appointment.customer_name ?? "Unnamed customer"}
          </p>
          <p className={`text-xs ${ui.muted}`}>
            {appointment.service_title_snapshot} · {appointment.employee_name_snapshot} · {appointment.location_name_snapshot}
          </p>
        </div>
        <span className={getStatusBadge(appointment.status as AppointmentStatus)}>
          {getStatusLabel(appointment.status as AppointmentStatus)}
        </span>
      </div>

      <p className={`text-xs ${ui.muted}`}>
        <LocalTime iso={appointment.starts_at} options={{ dateStyle: "medium", timeStyle: "short" }} />
        {" — "}
        <LocalTime iso={appointment.ends_at} options={{ timeStyle: "short" }} />
      </p>

      {appointment.cancellation_reason ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          Reason: {appointment.cancellation_reason}
        </p>
      ) : null}

      {transitions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {transitions.filter((status) => status !== "cancelled" && status !== "no_show").map((target) => (
            <ServerActionToastForm key={target} action={transitionSalonAppointmentStatusAction} refreshOnSuccess={false}>
              <input type="hidden" name="studio_id" value={props.studioId} />
              <input type="hidden" name="appointment_id" value={appointment.id} />
              <input type="hidden" name="to_status" value={target} />
              <input type="hidden" name="idempotency_key" value={buildTransitionKey(appointment, target)} />
              <button type="submit" className={ui.btnSecondarySm}>
                {target === "checked_in"
                  ? "Check-in"
                  : target === "in_progress"
                    ? "Start"
                    : target === "confirmed"
                      ? "Confirm"
                      : "Complete"}
              </button>
            </ServerActionToastForm>
          ))}
        </div>
      ) : null}

      <details className="chevron rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-800">
        <summary className="cursor-pointer text-xs font-medium text-stone-700 dark:text-stone-300">Details & actions</summary>
        <div className="mt-3 grid gap-3">
          <div className={`grid gap-1 text-xs ${ui.muted}`}>
            <p><span className="font-medium text-stone-700 dark:text-stone-300">Appointment:</span> {appointment.id}</p>
            <p><span className="font-medium text-stone-700 dark:text-stone-300">Service:</span> {appointment.service_id}</p>
            <p><span className="font-medium text-stone-700 dark:text-stone-300">Employee:</span> {appointment.employee_id}</p>
            <p><span className="font-medium text-stone-700 dark:text-stone-300">Customer:</span> {appointment.salon_customer_id}</p>
          </div>

          {props.canManage && transitionSet.has("cancelled") ? (
            <ServerActionToastForm action={cancelSalonAppointmentAction} className="grid gap-2 sm:grid-cols-[1fr_auto]" refreshOnSuccess={false}>
              <input type="hidden" name="studio_id" value={props.studioId} />
              <input type="hidden" name="appointment_id" value={appointment.id} />
              <input
                name="reason"
                className={ui.input}
                placeholder="Cancellation reason"
                required
                defaultValue="customer_cancelled"
              />
              <input type="hidden" name="idempotency_key" value={`apt03-cancel:${appointment.id}:${appointment.updated_at}`} />
              <button type="submit" className={ui.btnDangerSm}>Cancel</button>
            </ServerActionToastForm>
          ) : null}

          {props.canManage && transitionSet.has("no_show") ? (
            <ServerActionToastForm action={transitionSalonAppointmentStatusAction} className="grid gap-2 sm:grid-cols-[1fr_auto]" refreshOnSuccess={false}>
              <input type="hidden" name="studio_id" value={props.studioId} />
              <input type="hidden" name="appointment_id" value={appointment.id} />
              <input type="hidden" name="to_status" value="no_show" />
              <input
                name="reason"
                className={ui.input}
                placeholder="No-show reason"
                required
                defaultValue="customer_no_show"
              />
              <input type="hidden" name="idempotency_key" value={buildTransitionKey(appointment, "no_show")} />
              <button type="submit" className={ui.btnDangerSm}>No-show</button>
            </ServerActionToastForm>
          ) : null}

          {canReschedule ? (
            <ServerActionToastForm action={rescheduleSalonAppointmentAction} className="grid gap-2 sm:grid-cols-2" refreshOnSuccess={false}>
              <input type="hidden" name="studio_id" value={props.studioId} />
              <input type="hidden" name="appointment_id" value={appointment.id} />
              <input type="hidden" name="idempotency_key" value={`apt03-reschedule:${appointment.id}:${appointment.updated_at}`} />

              <label className="flex flex-col gap-1">
                <span className={ui.label}>New start</span>
                <input
                  type="datetime-local"
                  name="new_starts_at"
                  className={ui.input}
                  defaultValue={toLocalDateTimeInputValue(appointment.starts_at)}
                  required
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={ui.label}>Reason</span>
                <input name="reason" className={ui.input} placeholder="rescheduled" defaultValue="rescheduled" />
              </label>

              <label className="flex flex-col gap-1">
                <span className={ui.label}>Location</span>
                <select name="new_location_id" className={ui.select} defaultValue={appointment.location_id}>
                  {props.locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className={ui.label}>Employee</span>
                <select name="new_employee_id" className={ui.select} defaultValue={appointment.employee_id}>
                  {props.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.display_name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className={ui.label}>Service</span>
                <select name="new_service_id" className={ui.select} defaultValue={appointment.service_id}>
                  {props.services.map((service) => (
                    <option key={service.id} value={service.id}>{service.name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className={ui.label}>Resources (UUID, comma-separated)</span>
                <input name="new_resource_ids" className={ui.input} placeholder="optional" />
              </label>

              <button type="submit" className={`${ui.btnPrimarySm} sm:col-span-2`}>Reschedule</button>
            </ServerActionToastForm>
          ) : null}
        </div>
      </details>
    </article>
  );
}

export default async function AppointmentCalendarPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      studioId: sp.studio_id ?? null,
      locationId: sp.location_id ?? null,
    },
    ["owner", "manager", "frontdesk", "instructor"],
  );

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to appointment calendar.</p>;
  }

  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the sidebar to continue.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const canManage = hasStudioRole(ctx, activeStudioId, ["owner", "manager", "frontdesk"]);
  const canRetryNotifications = hasStudioRole(ctx, activeStudioId, ["owner", "manager"]);
  const isInstructorOnly = !canManage && hasStudioRole(ctx, activeStudioId, ["instructor"]);
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);

  const [locationsResult, studioResult] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, studio_id")
      .eq("studio_id", activeStudioId)
      .eq("is_active", true)
      .order("name"),
    supabase.from("studios").select("id, contract_status").eq("id", activeStudioId).maybeSingle(),
  ]);

  const locations = locationsResult.data ?? [];
  const effectiveLocationId =
    selectedLocationId && locations.some((location) => location.id === selectedLocationId)
      ? selectedLocationId
      : null;
  const defaultOpsLocationId =
    effectiveLocationId ?? (!canViewAllLocations && accessibleLocationIds.length === 1 ? accessibleLocationIds[0] : null);
  const requiresLocationSelection = !canViewAllLocations && !defaultOpsLocationId;

  const admin = createAdminClient();
  const [servicesResult, customersResult, allEmployeesResult, ownEmployeeResult] = await Promise.all([
    admin
      .from("studio_services")
      .select("id, title")
      .eq("studio_id", activeStudioId)
      .eq("is_active", true)
      .order("title"),
    canManage
      ? admin
          .from("salon_customers")
          .select("id, full_name")
          .eq("studio_id", activeStudioId)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    canManage
      ? admin
          .from("employees")
          .select("id, display_name")
          .eq("studio_id", activeStudioId)
          .eq("employment_status", "active")
          .order("display_name")
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    admin
      .from("employees")
      .select("id, display_name")
      .eq("studio_id", activeStudioId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; display_name: string }>(),
  ]);

  const services = (servicesResult.data ?? []).map((service) => ({ id: service.id, name: service.title ?? "Unnamed" }));
  const customers = (customersResult.data ?? []).map((customer) => ({ id: customer.id, full_name: customer.full_name ?? "Unnamed" }));
  const employees = canManage
    ? (allEmployeesResult.data ?? []).map((employee) => ({ id: employee.id, display_name: employee.display_name ?? "Unnamed" }))
    : ownEmployeeResult.data
      ? [{ id: ownEmployeeResult.data.id, display_name: ownEmployeeResult.data.display_name ?? "My appointment" }]
      : [];

  const selectedView = sp.view === "week" ? "week" : "day";
  const anchorDate = sp.date ?? localISODate();
  const selectedStatus = sp.status && (sp.status === "all" || STATUS_OPTIONS.includes(sp.status as AppointmentStatus))
    ? sp.status
    : "all";

  const window = buildSgtCalendarWindow(selectedView, anchorDate);
  if (!window.rangeStartIso || !window.rangeEndIso) {
    return <p className={ui.error}>Invalid calendar date range.</p>;
  }

  const selectedEmployeeId = sp.employee_id?.trim() || null;
  const selectedServiceId = sp.service_id?.trim() || null;
  const statusFilters = selectedStatus === "all" ? null : [selectedStatus as AppointmentStatus];

  const calendarResult = await listAppointmentsForCalendar({
    userId: user.id,
    studioId: activeStudioId,
    rangeStartIso: window.rangeStartIso,
    rangeEndIso: window.rangeEndIso,
    locationId: effectiveLocationId,
    employeeId: selectedEmployeeId,
    serviceId: selectedServiceId,
    statuses: statusFilters,
  });

  const appointments = calendarResult.ok ? calendarResult.payload.appointments : [];
  const groupedByDate = groupByDate(appointments);

  const scopeQuery = new URLSearchParams();
  scopeQuery.set("studio_id", activeStudioId);
  if (effectiveLocationId) scopeQuery.set("location_id", effectiveLocationId);

  return (
    <div className="flex flex-col gap-8">
      <div className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={locations}
          selectedStudioId={activeStudioId}
          selectedLocationId={effectiveLocationId}
          allowAll={canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
        />
      </div>

      <div>
        <h1 className={ui.h1}>Appointments</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Day/week calendar with scoped status operations.
          {studioResult.data?.contract_status === "suspended" ? " Studio is suspended." : ""}
        </p>
      </div>

      {canManage ? (
        <section className={ui.card}>
          <h2 className={ui.h2}>Create appointment</h2>
          <ServerActionToastForm action={createSalonAppointmentAction} className="mt-4 grid gap-3 sm:grid-cols-2" refreshOnSuccess={false}>
            <input type="hidden" name="studio_id" value={activeStudioId} />
            <input type="hidden" name="idempotency_key" value={`apt03-create:${crypto.randomUUID()}`} />

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Location</span>
              <select name="location_id" className={ui.select} defaultValue={effectiveLocationId ?? locations[0]?.id ?? ""} required>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Customer</span>
              <select name="salon_customer_id" className={ui.select} required>
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.full_name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Service</span>
              <select name="service_id" className={ui.select} required>
                <option value="">Select service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Employee</span>
              <select name="employee_id" className={ui.select} required>
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.display_name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Starts at (SGT)</span>
              <input type="datetime-local" name="starts_at" className={ui.input} required />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Resources (UUID, comma-separated)</span>
              <input name="resource_ids" className={ui.input} placeholder="optional" />
            </label>

            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={ui.label}>Internal note</span>
              <input name="internal_note" className={ui.input} />
            </label>

            <button type="submit" className={`${ui.btnPrimarySm} sm:col-span-2 sm:w-fit`}>Create appointment</button>
          </ServerActionToastForm>
        </section>
      ) : null}

      <section>
        <h2 className={ui.h2}>Calendar</h2>
        <form method="get" className={`${ui.card} mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          <input type="hidden" name="studio_id" value={activeStudioId} />
          {effectiveLocationId ? <input type="hidden" name="location_id" value={effectiveLocationId} /> : null}

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>View</span>
            <select name="view" className={ui.select} defaultValue={selectedView}>
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Anchor date</span>
            <input type="date" name="date" className={ui.input} defaultValue={anchorDate} required />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Employee</span>
            <select name="employee_id" className={ui.select} defaultValue={selectedEmployeeId ?? ""}>
              <option value="">All employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.display_name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Service</span>
            <select name="service_id" className={ui.select} defaultValue={selectedServiceId ?? ""}>
              <option value="">All services</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
            <span className={ui.label}>Status</span>
            <select name="status" className={ui.select} defaultValue={selectedStatus}>
              <option value="all">All</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{getStatusLabel(status)}</option>
              ))}
            </select>
          </label>

          <div className={`${ui.mobileActionBar} flex flex-col items-stretch gap-2 sm:col-span-2 sm:flex-row sm:items-end lg:col-span-4`}>
            <button type="submit" className={ui.btnPrimarySm}>Apply</button>
            <DashboardAppLink href={`/dashboard/appointments?${scopeQuery.toString()}`} className={ui.btnGhost}>Reset</DashboardAppLink>
          </div>
        </form>

        {!calendarResult.ok ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            {calendarResult.message || "Could not load calendar appointments."}
          </div>
        ) : null}

        {selectedView === "day" ? (
          appointments.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {appointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  studioId={activeStudioId}
                  canManage={canManage}
                  isInstructorOnly={isInstructorOnly}
                  locations={locations.map((location) => ({ id: location.id, name: location.name ?? "Unnamed" }))}
                  services={services}
                  employees={employees}
                />
              ))}
            </div>
          ) : (
            <div className={`mt-4 ${ui.emptyState}`}>
              <div className={ui.emptyStateIcon}><CalendarX2 size={18} /></div>
              <p className={`text-sm ${ui.muted}`}>No appointments in this day view.</p>
            </div>
          )
        ) : (
          <div className="mt-4 overflow-x-auto">
            <div className="grid min-w-[980px] grid-cols-7 gap-3">
              {window.dayKeys.map((dayKey) => (
                <section key={dayKey} className="rounded-2xl border border-stone-200 bg-white/90 p-3 dark:border-stone-800 dark:bg-stone-900/60">
                  <header className="mb-2">
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{formatLocalDate(`${dayKey}T00:00:00+08:00`)}</p>
                    <p className={`text-xs ${ui.muted}`}>{(groupedByDate.get(dayKey) ?? []).length} appointments</p>
                  </header>

                  <div className="flex flex-col gap-2">
                    {(groupedByDate.get(dayKey) ?? []).length === 0 ? (
                      <p className={`rounded-lg border border-dashed border-stone-200 px-2 py-3 text-center text-xs ${ui.muted} dark:border-stone-700`}>
                        No appointments
                      </p>
                    ) : (
                      (groupedByDate.get(dayKey) ?? []).map((appointment) => (
                        <AppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          studioId={activeStudioId}
                          canManage={canManage}
                          isInstructorOnly={isInstructorOnly}
                          locations={locations.map((location) => ({ id: location.id, name: location.name ?? "Unnamed" }))}
                          services={services}
                          employees={employees}
                        />
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        <div className={`mt-4 flex items-center gap-2 text-xs ${ui.muted}`}>
          <CalendarDays size={14} />
          Calendar range uses inclusive start and exclusive end boundaries on appointment start time.
        </div>
      </section>

      {canManage ? (
        <AppointmentNotificationOpsPanel
          studioId={activeStudioId}
          locationId={defaultOpsLocationId}
          canRetry={canRetryNotifications}
          requiresLocationSelection={requiresLocationSelection}
        />
      ) : null}
    </div>
  );
}

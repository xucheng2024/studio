import { DashboardAppLink } from "@/components/DashboardAppLink";
import { LocalTime } from "@/components/ui/LocalTime";
import { ui } from "@/lib/ui";
import { profileListRow } from "./shared";

export type CustomerAppointmentRow = {
  id: string;
  location_id: string;
  service_title_snapshot: string;
  starts_at: string;
  employee_name_snapshot: string;
  employee_id: string;
  status: string;
  location_name_snapshot?: string | null;
};

function appointmentStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function appointmentBadge(status: string) {
  if (status === "completed") return ui.badge;
  if (status === "cancelled" || status === "no_show") return ui.badgeRed;
  if (status === "pending") return ui.badgeAmber;
  return ui.badgeNeutral;
}

function AppointmentList({ rows, empty }: { rows: CustomerAppointmentRow[]; empty: string }) {
  if (rows.length === 0) {
    return (
      <div className={`mt-3 ${ui.emptyState}`}>
        <p className={`text-sm ${ui.muted}`}>{empty}</p>
      </div>
    );
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className={profileListRow}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{row.service_title_snapshot}</span>
            <span className={`shrink-0 capitalize ${appointmentBadge(row.status)}`}>{appointmentStatusLabel(row.status)}</span>
          </div>
          <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
            <span><LocalTime iso={row.starts_at} /></span>
            <span>{row.employee_name_snapshot}</span>
            {row.location_name_snapshot ? <span>{row.location_name_snapshot}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ClientAppointmentsSection({
  upcoming,
  history,
  calendarHref,
}: {
  upcoming: CustomerAppointmentRow[];
  history: CustomerAppointmentRow[];
  calendarHref: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={ui.h2}>Appointments</h2>
        <DashboardAppLink href={calendarHref} className={ui.btnSecondarySm}>Open calendar</DashboardAppLink>
      </div>
      <section>
        <h3 className={ui.h3}>Upcoming</h3>
        <AppointmentList rows={upcoming} empty="No upcoming appointments." />
      </section>
      <section>
        <h3 className={ui.h3}>History</h3>
        <AppointmentList rows={history} empty="No appointment history." />
      </section>
    </div>
  );
}

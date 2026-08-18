import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { LocalTime } from "@/components/ui/LocalTime";
import { createOrLinkTreatmentFromAppointmentAction, reviseTreatmentAction } from "@/app/(app)/dashboard/actions";
import type { CustomerTreatmentDetail } from "@/lib/salon-treatments";
import { ui } from "@/lib/ui";
import type { CustomerAppointmentRow } from "./appointments-section";
import { SaveBar, ScopeFields, type ClientProfileScope } from "./shared";

type EmployeeOption = { id: string; display_name: string };

export function ClientTreatmentsSection({
  scope,
  completedAppointments,
  employees,
  treatmentResult,
}: {
  scope: ClientProfileScope;
  completedAppointments: CustomerAppointmentRow[];
  employees: EmployeeOption[];
  treatmentResult: { ok: false } | { ok: true; rows: CustomerTreatmentDetail[] };
}) {
  return (
    <section className={ui.card}>
      <h2 className={ui.h2}>Treatments</h2>
      <p className={`mt-1 text-xs ${ui.muted}`}>Link a completed appointment, then add revisions without leaving this section.</p>

      <ServerActionToastForm action={createOrLinkTreatmentFromAppointmentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <ScopeFields scope={scope} />
        <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Completed appointment</span>
          <select name="appointment_id" className={ui.select} required defaultValue="">
            <option value="" disabled>Select completed appointment</option>
            {completedAppointments.map((appointment) => (
              <option key={appointment.id} value={appointment.id}>
                {appointment.service_title_snapshot} · {appointment.employee_name_snapshot} · {appointment.starts_at.slice(0, 10)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Lifecycle status</span>
          <select name="lifecycle_status" className={ui.select} defaultValue="open">
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Actual service employee (optional override)</span>
          <select name="actual_employee_id" className={ui.select} defaultValue="">
            <option value="">Use appointment employee</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.display_name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Revision reason</span>
          <input name="revision_reason" className={ui.input} placeholder="e.g. initial_record" />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Note summary (non-sensitive)</span>
          <textarea name="note_summary" rows={2} className={ui.input} />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Sensitive treatment note</span>
          <textarea name="sensitive_note_body" rows={3} className={ui.input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Follow-up due date (optional)</span>
          <input name="follow_up_due_on" type="date" className={ui.input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Follow-up owner (optional)</span>
          <select name="follow_up_owner_employee_id" className={ui.select} defaultValue="">
            <option value="">Unassigned</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.display_name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Follow-up note (non-sensitive)</span>
          <textarea name="follow_up_note_summary" rows={2} className={ui.input} />
        </label>
        <SaveBar><button type="submit" className={ui.btnPrimarySm}>Create / link treatment</button></SaveBar>
      </ServerActionToastForm>

      {!treatmentResult.ok ? (
        <p className={`mt-3 text-sm ${ui.muted}`}>Treatment data is outside your authorized CRM-02 scope.</p>
      ) : treatmentResult.rows.length === 0 ? (
        <p className={`mt-3 text-sm ${ui.muted}`}>No treatments yet for this customer in current scope.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {treatmentResult.rows.map((row) => (
            <article key={row.treatment.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-3 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{row.treatment.service_title_snapshot}</p>
                  <p className={`text-xs ${ui.muted}`}>
                    employee: {row.treatment.actual_employee_name_snapshot} · appointment: {row.treatment.appointment_id.slice(0, 8)} · status: {row.treatment.lifecycle_status}
                  </p>
                </div>
                <p className={`text-xs ${ui.muted}`}><LocalTime iso={row.treatment.created_at} /></p>
              </div>
              <div className="mt-2 rounded-lg border border-stone-200/80 bg-stone-50/70 px-2.5 py-2 dark:border-stone-700 dark:bg-stone-900/40">
                <p className="text-xs font-medium text-stone-800 dark:text-stone-200">Latest revision</p>
                <p className={`mt-1 text-xs ${ui.muted}`}>
                  {row.latestRevision
                    ? `#${row.latestRevision.revision_no} · ${row.latestRevision.lifecycle_status} · ${row.latestRevision.revision_reason ?? "no_reason"}`
                    : "No revision details."}
                </p>
                <p className={`mt-1 text-xs ${ui.muted}`}>{row.latestRevision?.note_summary ?? "No non-sensitive summary."}</p>
              </div>
              <ServerActionToastForm action={reviseTreatmentAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                <ScopeFields scope={scope} />
                <input type="hidden" name="treatment_id" value={row.treatment.id} />
                <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                <label className="flex flex-col gap-1.5"><span className={ui.label}>Lifecycle</span><select name="lifecycle_status" className={ui.select} defaultValue={row.treatment.lifecycle_status}><option value="open">Open</option><option value="completed">Completed</option><option value="archived">Archived</option></select></label>
                <label className="flex flex-col gap-1.5"><span className={ui.label}>Revision reason</span><input name="revision_reason" className={ui.input} /></label>
                <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Note summary (non-sensitive)</span><textarea name="note_summary" rows={2} className={ui.input} /></label>
                <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Sensitive treatment note</span><textarea name="sensitive_note_body" rows={2} className={ui.input} /></label>
                <SaveBar><button type="submit" className={ui.btnSecondarySm}>Add revision</button></SaveBar>
              </ServerActionToastForm>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

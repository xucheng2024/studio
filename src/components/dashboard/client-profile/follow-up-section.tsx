import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { upsertTreatmentFollowUpAction } from "@/app/(app)/dashboard/actions";
import { localISODate } from "@/lib/date";
import type { CustomerTreatmentDetail, SalonTreatmentFollowUp } from "@/lib/salon-treatments";
import { ui } from "@/lib/ui";
import { SaveBar, ScopeFields, type ClientProfileScope } from "./shared";

type EmployeeOption = { id: string; display_name: string };
type FlatFollowUp = SalonTreatmentFollowUp & { serviceTitle: string };

function followUpRank(status: string) {
  if (status === "pending") return 0;
  if (status === "in_progress") return 1;
  if (status === "done") return 2;
  return 3;
}

export function ClientFollowUpSection({
  scope,
  treatmentResult,
  employees,
  queueHref,
}: {
  scope: ClientProfileScope;
  treatmentResult: { ok: false } | { ok: true; rows: CustomerTreatmentDetail[] };
  employees: EmployeeOption[];
  queueHref: string;
}) {
  const today = localISODate();
  const followUps: FlatFollowUp[] = treatmentResult.ok
    ? treatmentResult.rows.flatMap((row) =>
        row.followUps.map((followUp) => ({ ...followUp, serviceTitle: row.treatment.service_title_snapshot })),
      )
    : [];
  followUps.sort((left, right) => {
    const rank = followUpRank(left.status) - followUpRank(right.status);
    if (rank !== 0) return rank;
    return left.due_on.localeCompare(right.due_on);
  });

  return (
    <section className={ui.card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className={ui.h2}>Follow-up</h2>
          <p className={`mt-1 text-xs ${ui.muted}`}>Pending and overdue items first. Open the studio queue for due-date sorting across customers.</p>
        </div>
        <DashboardAppLink href={queueHref} className={ui.btnSecondarySm}>Open follow-up queue</DashboardAppLink>
      </div>

      {!treatmentResult.ok ? (
        <p className={`mt-3 text-sm ${ui.muted}`}>Follow-up data is outside your authorized CRM-02 scope.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {followUps.map((followUp) => {
            const overdue = (followUp.status === "pending" || followUp.status === "in_progress") && followUp.due_on < today;
            return (
              <ServerActionToastForm key={followUp.id} action={upsertTreatmentFollowUpAction} className="rounded-lg border border-stone-200/80 bg-stone-50/60 px-2.5 py-2 dark:border-stone-700 dark:bg-stone-900/40">
                <ScopeFields scope={scope} />
                <input type="hidden" name="treatment_id" value={followUp.treatment_id} />
                <input type="hidden" name="follow_up_id" value={followUp.id} />
                <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{followUp.serviceTitle}</p>
                  {overdue ? <span className={ui.badgeAmber}>Overdue</span> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Due date</span><input name="due_on" type="date" defaultValue={followUp.due_on} className={ui.input} /></label>
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Status</span><select name="status" defaultValue={followUp.status} className={ui.select}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Owner</span><select name="owner_employee_id" defaultValue={followUp.owner_employee_id ?? ""} className={ui.select}><option value="">Unassigned</option>{employees.map((employee) => (<option key={employee.id} value={employee.id}>{employee.display_name}</option>))}</select></label>
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Note (non-sensitive)</span><input name="note_summary" defaultValue={followUp.note_summary ?? ""} className={ui.input} /></label>
                </div>
                <SaveBar><button type="submit" className={`${ui.btnGhost} mt-2`}>Save follow-up</button></SaveBar>
              </ServerActionToastForm>
            );
          })}

          {treatmentResult.rows.length > 0 ? (
            <ServerActionToastForm action={upsertTreatmentFollowUpAction} className="rounded-lg border border-dashed border-stone-300 px-2.5 py-2 dark:border-stone-700">
              <ScopeFields scope={scope} />
              <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className={ui.label}>Treatment</span>
                  <select name="treatment_id" className={ui.select} required defaultValue="">
                    <option value="" disabled>Select treatment</option>
                    {treatmentResult.rows.map((row) => (
                      <option key={row.treatment.id} value={row.treatment.id}>{row.treatment.service_title_snapshot}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5"><span className={ui.label}>New due date</span><input name="due_on" type="date" className={ui.input} /></label>
                <label className="flex flex-col gap-1.5"><span className={ui.label}>Owner</span><select name="owner_employee_id" className={ui.select} defaultValue=""><option value="">Unassigned</option>{employees.map((employee) => (<option key={employee.id} value={employee.id}>{employee.display_name}</option>))}</select></label>
                <label className="flex flex-col gap-1.5"><span className={ui.label}>Status</span><select name="status" className={ui.select} defaultValue="pending"><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
                <label className="flex flex-col gap-1.5"><span className={ui.label}>Note (non-sensitive)</span><input name="note_summary" className={ui.input} /></label>
              </div>
              <SaveBar><button type="submit" className={`${ui.btnSecondarySm} mt-2`}>Add follow-up</button></SaveBar>
            </ServerActionToastForm>
          ) : (
            <p className={`text-sm ${ui.muted}`}>Create a treatment first, then add a follow-up here.</p>
          )}
        </div>
      )}
    </section>
  );
}

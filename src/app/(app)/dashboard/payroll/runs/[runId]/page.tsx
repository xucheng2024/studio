import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import {
  recalculatePayrollRunAction,
  savePayrollRunEmployeeInputsAction,
  transitionPayrollRunAction,
} from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { isOwnerPayrollRole, listStudioEmployeesForPayroll } from "@/lib/payroll-profiles";
import { getPayrollRun, listPayrollRunEmployees, listPayrollRunLines } from "@/lib/payroll-runs";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ studio_id?: string; employee_id?: string }>;
};

export default async function PayrollRunPage({ params, searchParams }: Props) {
  const { runId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId } = await getDashboardScopeForRoles(
    { userId: user.id, email: user.email, studioId: sp.studio_id ?? null, locationId: null },
    ["owner"],
  );
  if (studioIds.length === 0) return <p className={ui.muted}>Only studio owners can open Payroll.</p>;
  const studioId = selectedStudioId ?? studioIds[0];
  if (!isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId })) {
    return <p className={ui.muted}>Only studio owners can open Payroll.</p>;
  }

  const run = await getPayrollRun(studioId, runId);
  if (!run) return <p className={ui.muted}>Payroll run not found.</p>;
  const [rows, employees] = await Promise.all([
    listPayrollRunEmployees(run.id),
    listStudioEmployeesForPayroll(studioId),
  ]);
  const lines = await listPayrollRunLines(rows.map((row) => row.id));
  const nameById = new Map(employees.map((employee) => [employee.id, employee.display_name]));
  const selectedId = sp.employee_id && rows.some((row) => row.employee_id === sp.employee_id) ? sp.employee_id : rows[0]?.employee_id;
  const selected = rows.find((row) => row.employee_id === selectedId) ?? null;
  const selectedLines = selected ? lines.filter((line) => line.payroll_run_employee_id === selected.id) : [];
  const blockerCount = rows.filter((row) => row.blocker_codes.length).length;
  const isDraft = run.status === "draft";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/payroll" className={`${ui.btnSecondarySm} mb-3`}>← Payroll</DashboardAppLink>
        <h1 className={ui.h1}>{run.period_start.slice(0, 7)} payroll</h1>
        <p className={`mt-1 ${ui.muted}`}>
          {run.status} · {run.period_start} to {run.period_end} · rule {run.rule_version_id}
          {run.company_sdl_sgd ? ` · company SDL $${run.company_sdl_sgd}` : ""}
        </p>
      </div>

      {blockerCount ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">{blockerCount} employee(s) still block Finalise.</p> : null}

      <div className="flex flex-wrap gap-3">
        {isDraft ? (
          <ServerActionToastForm action={recalculatePayrollRunAction}>
            <input type="hidden" name="studio_id" value={studioId} />
            <input type="hidden" name="run_id" value={run.id} />
            <SubmitButton className={ui.btnSecondarySm}>Recalculate</SubmitButton>
          </ServerActionToastForm>
        ) : null}
        {isDraft ? (
          <ServerActionToastForm action={transitionPayrollRunAction}>
            <input type="hidden" name="studio_id" value={studioId} />
            <input type="hidden" name="run_id" value={run.id} />
            <input type="hidden" name="to_status" value="finalised" />
            <SubmitButton className={ui.btnPrimarySm} disabled={blockerCount > 0}>Finalise</SubmitButton>
          </ServerActionToastForm>
        ) : null}
      </div>

      {run.status === "finalised" ? (
        <ServerActionToastForm action={transitionPayrollRunAction} className={`${ui.card} grid gap-3 md:grid-cols-3`}>
          <input type="hidden" name="studio_id" value={studioId} />
          <input type="hidden" name="run_id" value={run.id} />
          <input type="hidden" name="to_status" value="paid" />
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Paid on</span><input className={ui.input} type="date" name="paid_on" required /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Payment reference</span><input className={ui.input} name="payment_reference" /></label>
          <div className="self-end"><SubmitButton className={ui.btnPrimary}>Mark paid</SubmitButton></div>
        </ServerActionToastForm>
      ) : null}

      {run.status !== "voided" ? (
        <ServerActionToastForm action={transitionPayrollRunAction} className={`${ui.card} grid gap-3 md:grid-cols-2`}>
          <input type="hidden" name="studio_id" value={studioId} />
          <input type="hidden" name="run_id" value={run.id} />
          <input type="hidden" name="to_status" value="voided" />
          <label className="flex flex-col gap-1.5 md:col-span-2"><span className={ui.label}>Void reason</span><input className={ui.input} name="void_reason" required /></label>
          <SubmitButton className={ui.btnSecondarySm}>Void run</SubmitButton>
        </ServerActionToastForm>
      ) : null}

      <section>
        <h2 className={`${ui.h2} mb-3`}>Employees</h2>
        <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-stone-500"><th className="p-3">Name</th><th className="p-3">Gross</th><th className="p-3">Net</th><th className="p-3">Blockers</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="p-3">
                    <DashboardAppLink href={`/dashboard/payroll/runs/${run.id}?employee_id=${row.employee_id}`} className="underline-offset-2 hover:underline">
                      {nameById.get(row.employee_id) ?? row.employee_id}
                    </DashboardAppLink>
                  </td>
                  <td className="p-3">{row.gross_sgd}</td>
                  <td className="p-3">{row.net_sgd}</td>
                  <td className="p-3">{row.blocker_codes.length || "Ready"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && isDraft ? (
        <ServerActionToastForm action={savePayrollRunEmployeeInputsAction} className={`${ui.card} grid gap-4 md:grid-cols-2`}>
          <input type="hidden" name="studio_id" value={studioId} />
          <input type="hidden" name="run_id" value={run.id} />
          <input type="hidden" name="employee_id" value={selected.employee_id} />
          <h2 className={`${ui.h2} md:col-span-2`}>{nameById.get(selected.employee_id)} inputs</h2>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Working days in month</span><input className={ui.input} name="working_days_in_month" defaultValue={selected.working_days_in_month ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Days actually worked</span><input className={ui.input} name="days_actually_worked" defaultValue={selected.days_actually_worked ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Hours worked</span><input className={ui.input} name="hours_worked" defaultValue={selected.hours_worked ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Overtime hours</span><input className={ui.input} name="overtime_hours" defaultValue={selected.overtime_hours ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Contract overtime</span><input className={ui.input} name="contract_overtime_sgd" defaultValue={selected.contract_overtime_sgd ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Allowance</span><input className={ui.input} name="allowance_sgd" defaultValue={selected.allowance_sgd ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Bonus</span><input className={ui.input} name="bonus_sgd" defaultValue={selected.bonus_sgd ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Unpaid absence</span><input className={ui.input} name="unpaid_absence_sgd" defaultValue={selected.unpaid_absence_sgd ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Other deduction</span><input className={ui.input} name="other_deduction_sgd" defaultValue={selected.other_deduction_sgd ?? ""} /></label>
          <label className="flex flex-col gap-1.5 md:col-span-2"><span className={ui.label}>Note</span><input className={ui.input} name="input_note" defaultValue={selected.input_note ?? ""} /></label>
          <div className="md:col-span-2"><SubmitButton className={ui.btnPrimary}>Save inputs</SubmitButton></div>
        </ServerActionToastForm>
      ) : null}

      {selectedLines.length ? (
        <section>
          <h2 className={`${ui.h2} mb-3`}>Lines</h2>
          <ul className="space-y-1 text-sm">
            {selectedLines.map((line) => (
              <li key={line.id} className="flex justify-between rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-800">
                <span>{line.item_code} · {line.wage_class}</span>
                <span>{line.amount_sgd}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

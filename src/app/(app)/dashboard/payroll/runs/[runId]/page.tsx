import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { PayrollRunActions } from "@/components/dashboard/PayrollRunActions";
import { SubmitButton } from "@/components/SubmitButton";
import {
  copyPreviousPayrollAttendanceAction,
  recalculatePayrollRunAction,
  savePayrollRunEmployeeInputsAction,
} from "@/app/(app)/dashboard/actions";
import { localISODate } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { isOwnerPayrollRole, listCurrentPayrollProfiles, listStudioEmployeesForPayroll } from "@/lib/payroll-profiles";
import { getPayrollRun, getPreviousPublishedPayrollRun, listPayrollRunEmployees, listPayrollRunLines } from "@/lib/payroll-runs";
import { payrollStatusBadgeClass, payrollStatusLabel } from "@/lib/payroll-ui";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ studio_id?: string; employee_id?: string }>;
};

const STEPS = ["Draft", "Review", "Finalise", "Paid"] as const;

function stepIndex(status: string) {
  if (status === "paid") return 3;
  if (status === "finalised") return 2;
  if (status === "draft") return 1;
  return 0;
}

function money(values: Array<string | null | undefined>) {
  return values.reduce((sum, value) => sum + Number(value ?? 0), 0).toFixed(2);
}

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
  const [rows, employees, profiles, previousRun] = await Promise.all([
    listPayrollRunEmployees(run.id),
    listStudioEmployeesForPayroll(studioId),
    listCurrentPayrollProfiles(studioId),
    getPreviousPublishedPayrollRun(studioId, run.period_start),
  ]);
  const lines = await listPayrollRunLines(rows.map((row) => row.id));
  const nameById = new Map(employees.map((employee) => [employee.id, employee.display_name]));
  const salaryById = new Map(profiles.map((profile) => [profile.employee_id, profile.salary_type]));
  const selectedId = sp.employee_id && rows.some((row) => row.employee_id === sp.employee_id) ? sp.employee_id : rows[0]?.employee_id;
  const selected = rows.find((row) => row.employee_id === selectedId) ?? null;
  const selectedLines = selected ? lines.filter((line) => line.payroll_run_employee_id === selected.id) : [];
  const blockedRows = rows.filter((row) => row.blocker_codes.length);
  const blockerCount = blockedRows.length;
  const isDraft = run.status === "draft";
  const currentStep = stepIndex(run.status);
  const firstBlocked = blockedRows[0];
  const selectedSalary = selected ? salaryById.get(selected.employee_id) : null;
  const isHourly = selectedSalary === "hourly";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/payroll" className={`${ui.btnSecondarySm} mb-3`}>← Payroll</DashboardAppLink>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={ui.h1}>{run.period_start.slice(0, 7)} payroll</h1>
          <span className={payrollStatusBadgeClass(run.status)}>{payrollStatusLabel(run.status)}</span>
        </div>
        <p className={`mt-1 ${ui.muted}`}>
          {run.period_start} to {run.period_end} · rule {run.rule_version_id}
        </p>
      </div>

      {run.status === "voided" ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100">
          Voided{run.void_reason ? `: ${run.void_reason}` : "."}
        </p>
      ) : (
        <ol className="grid grid-cols-4 gap-2 text-center text-xs font-medium">
          {STEPS.map((label, index) => {
            const done = index < currentStep || run.status === "paid";
            const current = index === currentStep && run.status !== "paid";
            return (
              <li
                key={label}
                className={`rounded-xl border px-2 py-2 ${
                  done
                    ? "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/40 dark:bg-teal-950/40 dark:text-teal-100"
                    : current
                      ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                      : "border-stone-200 text-stone-400 dark:border-stone-800"
                }`}
              >
                {label}
              </li>
            );
          })}
        </ol>
      )}

      <section className={`${ui.card} grid gap-3 sm:grid-cols-4`}>
        <div>
          <p className={ui.muted}>Employees</p>
          <p className="text-lg font-semibold">{rows.length}</p>
          <p className="text-xs text-stone-500">{rows.length - blockerCount} ready / {blockerCount} blocked</p>
        </div>
        <div>
          <p className={ui.muted}>Gross</p>
          <p className="text-lg font-semibold">${money(rows.map((row) => row.gross_sgd))}</p>
        </div>
        <div>
          <p className={ui.muted}>Net</p>
          <p className="text-lg font-semibold">${money(rows.map((row) => row.net_sgd))}</p>
        </div>
        <div>
          <p className={ui.muted}>Employer CPF / SDL</p>
          <p className="text-lg font-semibold">${money(rows.map((row) => row.employer_cpf_sgd))} / ${run.company_sdl_sgd ?? "0.00"}</p>
        </div>
      </section>

      {blockerCount ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {blockerCount} employee(s) still block Finalise.
          {firstBlocked ? (
            <>
              {" "}
              <DashboardAppLink href={`/dashboard/payroll/runs/${run.id}?employee_id=${firstBlocked.employee_id}`} className="font-medium underline-offset-2 hover:underline">
                Review {nameById.get(firstBlocked.employee_id) ?? "employee"}
              </DashboardAppLink>
            </>
          ) : null}
        </p>
      ) : isDraft ? (
        <p className={ui.success}>Review totals and employee lines, then Finalise to lock this month.</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {isDraft ? (
          <div className="flex flex-wrap gap-2">
            <ServerActionToastForm action={recalculatePayrollRunAction}>
              <input type="hidden" name="studio_id" value={studioId} />
              <input type="hidden" name="run_id" value={run.id} />
              <SubmitButton className={ui.btnSecondarySm}>Recalculate</SubmitButton>
            </ServerActionToastForm>
            {previousRun ? (
              <ServerActionToastForm action={copyPreviousPayrollAttendanceAction}>
                <input type="hidden" name="studio_id" value={studioId} />
                <input type="hidden" name="run_id" value={run.id} />
                <SubmitButton className={ui.btnSecondarySm}>Copy last month days and hours</SubmitButton>
              </ServerActionToastForm>
            ) : null}
          </div>
        ) : null}
        <PayrollRunActions
          studioId={studioId}
          runId={run.id}
          status={run.status}
          blockerCount={blockerCount}
          paidOnDefault={localISODate()}
        />
      </div>

      <section>
        <h2 className={`${ui.h2} mb-3`}>Employees</h2>
        <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-stone-500"><th className="p-3">Name</th><th className="p-3">Gross</th><th className="p-3">Net</th><th className="p-3">Payslip</th><th className="p-3">Blockers</th></tr></thead>
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
                  <td className="p-3">
                    {row.payslip_number && (run.status === "finalised" || run.status === "paid") ? (
                      <DashboardAppLink href={`/dashboard/payroll/payslips/${row.id}`} className="underline-offset-2 hover:underline">
                        View payslip
                      </DashboardAppLink>
                    ) : "—"}
                  </td>
                  <td className="p-3">
                    {row.blocker_codes.length ? (
                      <span className={ui.badgeAmber}>{row.blocker_codes.length} blocked</span>
                    ) : (
                      <span className={ui.badge}>Ready</span>
                    )}
                  </td>
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
          {isHourly ? (
            <>
              <input type="hidden" name="working_days_in_month" value={selected.working_days_in_month ?? ""} />
              <input type="hidden" name="days_actually_worked" value={selected.days_actually_worked ?? ""} />
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className={ui.label}>Hours worked</span>
                <input className={ui.input} name="hours_worked" defaultValue={selected.hours_worked ?? ""} />
              </label>
            </>
          ) : (
            <>
              <input type="hidden" name="hours_worked" value={selected.hours_worked ?? ""} />
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Working days in month</span>
                <input className={ui.input} name="working_days_in_month" defaultValue={selected.working_days_in_month ?? ""} />
                <span className={ui.muted}>Leave blank for a full month.</span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Days actually worked</span>
                <input className={ui.input} name="days_actually_worked" defaultValue={selected.days_actually_worked ?? ""} />
              </label>
            </>
          )}
          <details className="md:col-span-2">
            <summary className="cursor-pointer text-sm font-medium text-stone-700 dark:text-stone-300">Adjustments</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Overtime hours</span><input className={ui.input} name="overtime_hours" defaultValue={selected.overtime_hours ?? ""} /></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Contract overtime</span><input className={ui.input} name="contract_overtime_sgd" defaultValue={selected.contract_overtime_sgd ?? ""} /></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Allowance</span><input className={ui.input} name="allowance_sgd" defaultValue={selected.allowance_sgd ?? ""} /></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Bonus</span><input className={ui.input} name="bonus_sgd" defaultValue={selected.bonus_sgd ?? ""} /></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Unpaid absence</span><input className={ui.input} name="unpaid_absence_sgd" defaultValue={selected.unpaid_absence_sgd ?? ""} /></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Other deduction</span><input className={ui.input} name="other_deduction_sgd" defaultValue={selected.other_deduction_sgd ?? ""} /></label>
              <label className="flex flex-col gap-1.5 md:col-span-2"><span className={ui.label}>Note</span><input className={ui.input} name="input_note" defaultValue={selected.input_note ?? ""} /></label>
            </div>
          </details>
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

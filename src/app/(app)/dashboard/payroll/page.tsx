import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { createPayrollRunAction } from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import {
  isOwnerPayrollRole,
  listCurrentPayrollProfiles,
  listStudioEmployeesForPayroll,
  profileToInput,
} from "@/lib/payroll-profiles";
import { listPayrollRuns } from "@/lib/payroll-runs";
import { payrollStatusBadgeClass, payrollStatusLabel, previousSgtMonth } from "@/lib/payroll-ui";
import { officialRuleSnapshot, validateProfileForFinalise } from "@/lib/statutory-payroll";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

export default async function PayrollPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId } = await getDashboardScopeForRoles(
    { userId: user.id, email: user.email, studioId: sp.studio_id ?? null, locationId: null },
    ["owner"],
  );
  if (studioIds.length === 0) return <p className={ui.muted}>Only studio owners can open Payroll.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const studioId = selectedStudioId ?? studioIds[0];
  if (!isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId })) {
    return <p className={ui.muted}>Only studio owners can open Payroll.</p>;
  }

  const employees = await listStudioEmployeesForPayroll(studioId);
  const [profiles, runs] = await Promise.all([
    listCurrentPayrollProfiles(studioId),
    listPayrollRuns(studioId),
  ]);
  const profileByEmployeeId = new Map(profiles.map((row) => [row.employee_id, row]));
  const rows = employees.map((employee) => {
    const profile = profileByEmployeeId.get(employee.id) ?? null;
    return { employee, profile, blockers: validateProfileForFinalise(profileToInput(profile)) };
  });
  const blocked = rows.filter((row) => row.blockers.length);
  const readyCount = rows.length - blocked.length;
  const firstBlocked = blocked[0]?.employee;
  const rules = officialRuleSnapshot();
  const targetMonth = previousSgtMonth();
  const targetRun = runs.find((run) => run.period_start.startsWith(targetMonth) && run.status !== "voided") ?? null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className={ui.h1}>Payroll</h1>
          <DashboardAppLink href="/dashboard/payroll/reports" className={ui.btnSecondarySm}>Reports</DashboardAppLink>
        </div>
        <p className={`mt-1 ${ui.muted}`}>Monthly Owner run: Draft, review, Finalise, then Paid or Void.</p>
      </div>

      <section className={`${ui.card} flex flex-col gap-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={ui.h2}>{targetMonth}</h2>
            <p className={`mt-1 ${ui.muted}`}>
              {targetRun
                ? `${payrollStatusLabel(targetRun.status)} run is ready to open.`
                : "Create a draft for last month, then review before Finalise."}
            </p>
          </div>
          {targetRun ? (
            <DashboardAppLink href={`/dashboard/payroll/runs/${targetRun.id}`} className={ui.btnPrimarySm}>
              Open {targetMonth}
            </DashboardAppLink>
          ) : null}
        </div>
        {rows.length ? (
          <p className="text-sm text-stone-700 dark:text-stone-300">
            {readyCount} ready / {blocked.length} blocked
            {firstBlocked ? (
              <>
                {" · "}
                <DashboardAppLink href={`/dashboard/payroll/${firstBlocked.id}`} className={ui.link}>
                  Fix {firstBlocked.display_name}
                </DashboardAppLink>
              </>
            ) : null}
          </p>
        ) : (
          <p className={ui.muted}>No employees yet. Add staff from Staff Access first.</p>
        )}
        <ServerActionToastForm action={createPayrollRunAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="studio_id" value={studioId} />
          <label className="flex min-w-40 flex-1 flex-col gap-1.5">
            <span className={ui.label}>New draft month</span>
            <input className={ui.input} type="month" name="period_month" required defaultValue={targetMonth} />
          </label>
          <SubmitButton className={targetRun ? ui.btnSecondary : ui.btnPrimary}>Create draft</SubmitButton>
        </ServerActionToastForm>
      </section>

      <section>
        <h2 className={`${ui.h2} mb-3`}>Runs</h2>
        {runs.length ? (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th className="p-3">Month</th><th className="p-3">Status</th><th className="p-3">SDL</th></tr></thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-stone-200 dark:border-stone-800">
                    <td className="p-3">
                      <DashboardAppLink href={`/dashboard/payroll/runs/${run.id}`} className="font-medium underline-offset-2 hover:underline">
                        {run.period_start.slice(0, 7)}
                      </DashboardAppLink>
                    </td>
                    <td className="p-3">
                      <span className={payrollStatusBadgeClass(run.status)}>{payrollStatusLabel(run.status)}</span>
                    </td>
                    <td className="p-3">{run.company_sdl_sgd ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={ui.muted}>No payroll runs yet.</p>
        )}
      </section>

      <section>
        <h2 className={`${ui.h2} mb-3`}>Employees</h2>
        {rows.length ? (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500">
                  <th className="p-3">Name</th>
                  <th className="p-3">Number</th>
                  <th className="p-3">Residency</th>
                  <th className="p-3">Pay</th>
                  <th className="p-3">Finalise</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee, profile, blockers }) => (
                  <tr key={employee.id} className="border-t border-stone-200 dark:border-stone-800">
                    <td className="p-3">
                      <DashboardAppLink href={`/dashboard/payroll/${employee.id}`} className="font-medium underline-offset-2 hover:underline">
                        {employee.display_name}
                      </DashboardAppLink>
                    </td>
                    <td className="p-3">{employee.employee_number || "—"}</td>
                    <td className="p-3 capitalize">{profile?.residency_status ?? "—"}</td>
                    <td className="p-3">{profile?.salary_type ? `${profile.salary_type} ${profile.basic_pay_sgd ?? ""}`.trim() : "—"}</td>
                    <td className="p-3">
                      {blockers.length ? (
                        <DashboardAppLink href={`/dashboard/payroll/${employee.id}`} className={ui.badgeAmber}>
                          {blockers.length} missing
                        </DashboardAppLink>
                      ) : (
                        <span className={ui.badge}>Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={ui.muted}>No employees yet. Add staff from Staff Access first.</p>
        )}
      </section>

      <p className={ui.muted}>
        {rules.id} · CPF OW ${rules.cpf.ow_monthly_ceiling_sgd} · SDL 0.25%. Unknown official cases block Finalise.
      </p>
    </div>
  );
}

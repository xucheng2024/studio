import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import {
  isOwnerPayrollRole,
  listCurrentPayrollProfiles,
  listStudioEmployeesForPayroll,
  profileToInput,
} from "@/lib/payroll-profiles";
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
  const profiles = await listCurrentPayrollProfiles(studioId);
  const profileByEmployeeId = new Map(profiles.map((row) => [row.employee_id, row]));
  const rows = employees.map((employee) => {
    const profile = profileByEmployeeId.get(employee.id) ?? null;
    return { employee, profile, blockers: validateProfileForFinalise(profileToInput(profile)) };
  });
  const rules = officialRuleSnapshot();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Payroll</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Restricted employee profiles and official CPF Board / MOM rules. Payroll runs and payslips come later.
        </p>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>Official rule version</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          {rules.id} · verified {rules.verified_at} · effective from {rules.source_effective_from}. Unknown official cases block Finalise.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-stone-700 dark:text-stone-300">
          <li>CPF OW ceiling ${rules.cpf.ow_monthly_ceiling_sgd} · annual ceiling ${rules.cpf.annual_salary_ceiling_sgd}</li>
          <li>SDL 0.25% · min ${rules.sdl.min_sgd} · max ${rules.sdl.max_sgd}</li>
          <li>No NRIC or bank account fields. Wage amounts stay off Staff Access.</li>
        </ul>
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
                    <td className="p-3">{blockers.length ? `${blockers.length} missing` : "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={ui.muted}>No employees yet. Add staff from Staff Access first.</p>
        )}
      </section>
    </div>
  );
}

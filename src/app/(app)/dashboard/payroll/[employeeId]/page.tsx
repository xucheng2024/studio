import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { savePayrollProfileAction } from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import {
  getCurrentPayrollProfile,
  getStudioEmployeeForPayroll,
  isOwnerPayrollRole,
  listPayrollProfileHistory,
  profileToInput,
} from "@/lib/payroll-profiles";
import { validateProfileForFinalise } from "@/lib/statutory-payroll";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ studio_id?: string }>;
};

export default async function PayrollEmployeePage({ params, searchParams }: Props) {
  const { employeeId } = await params;
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

  const employee = await getStudioEmployeeForPayroll(studioId, employeeId);
  if (!employee) return <p className={ui.muted}>Employee not found in this studio.</p>;
  const profile = await getCurrentPayrollProfile(studioId, employeeId);
  const history = await listPayrollProfileHistory(studioId, employeeId);
  const blockers = validateProfileForFinalise(profileToInput(profile));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/payroll" className={`${ui.btnSecondarySm} mb-3`}>
          ← Payroll
        </DashboardAppLink>
        <h1 className={ui.h1}>{employee.display_name}</h1>
        <p className={`mt-1 ${ui.muted}`}>
          {employee.employee_number || "No employee number"} · {employee.email || "No email"} · {employee.phone || "No phone"}
        </p>
      </div>

      {blockers.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">Finalise blockers</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {blockers.map((item) => <li key={item.code}>{item.message}</li>)}
          </ul>
        </section>
      ) : (
        <p className={ui.success}>Profile has the fields required for Finalise.</p>
      )}

      <ServerActionToastForm action={savePayrollProfileAction} className={`${ui.card} grid gap-4 md:grid-cols-2`}>
        <input type="hidden" name="studio_id" value={studioId} />
        <input type="hidden" name="employee_id" value={employee.id} />
        <h2 className={`${ui.h2} md:col-span-2`}>New profile version</h2>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Job title</span>
          <input className={ui.input} name="job_title" defaultValue={profile?.job_title ?? ""} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Effective from</span>
          <input className={ui.input} name="effective_from" type="date" required defaultValue={profile?.effective_from ?? today} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Date of birth</span>
          <input className={ui.input} name="date_of_birth" type="date" defaultValue={profile?.date_of_birth ?? ""} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Residency</span>
          <select className={ui.select} name="residency_status" defaultValue={profile?.residency_status ?? ""}>
            <option value="">Select</option>
            <option value="citizen">Singapore citizen</option>
            <option value="pr">PR</option>
            <option value="foreigner">Foreigner</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>PR granted on</span>
          <input className={ui.input} name="pr_granted_on" type="date" defaultValue={profile?.pr_granted_on ?? ""} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Salary type</span>
          <select className={ui.select} name="salary_type" defaultValue={profile?.salary_type ?? ""}>
            <option value="">Select</option>
            <option value="monthly">Monthly</option>
            <option value="hourly">Hourly</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Basic pay / hourly rate (SGD)</span>
          <input className={ui.input} name="basic_pay_sgd" type="number" min="0" step="0.01" defaultValue={profile?.basic_pay_sgd ?? ""} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Weekly hours</span>
          <input className={ui.input} name="weekly_hours" type="number" min="0" step="0.01" defaultValue={profile?.weekly_hours ?? ""} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>SHG fund</span>
          <select className={ui.select} name="shg_fund" defaultValue={profile?.shg_fund ?? ""}>
            <option value="">Select</option>
            <option value="cdac">CDAC</option>
            <option value="ecf">ECF</option>
            <option value="mbmf">MBMF</option>
            <option value="sinda">SINDA</option>
            <option value="none">None / not set</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>SHG mode</span>
          <select className={ui.select} name="shg_mode" defaultValue={profile?.shg_mode ?? "standard"}>
            <option value="standard">Standard band</option>
            <option value="opt_out">Opt out</option>
            <option value="custom_amount">Custom amount</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Custom SHG amount</span>
          <input className={ui.input} name="shg_custom_amount_sgd" type="number" min="0" step="0.01" defaultValue={profile?.shg_custom_amount_sgd ?? ""} />
        </label>
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className={ui.label}>SHG proof note</span>
          <textarea className={ui.input} name="shg_proof_note" rows={2} defaultValue={profile?.shg_proof_note ?? ""} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="cpf_full_rate_elected" defaultChecked={Boolean(profile?.cpf_full_rate_elected)} />
          CPF full-rate election recorded
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ea_part4_overtime_covered" defaultChecked={Boolean(profile?.ea_part4_overtime_covered)} />
          Employment Act Part 4 overtime
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" name="is_workman" defaultChecked={Boolean(profile?.is_workman)} />
          Workman (overtime cap $4,500)
        </label>
        <div className="md:col-span-2">
          <SubmitButton className={ui.btnPrimary}>Save new version</SubmitButton>
        </div>
      </ServerActionToastForm>

      <section>
        <h2 className={`${ui.h2} mb-3`}>Version history</h2>
        {history.length ? (
          <ul className="space-y-2 text-sm">
            {history.map((row) => (
              <li key={row.id} className="rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-800">
                {row.effective_from}{row.effective_to ? ` → ${row.effective_to}` : " · current"} · {row.residency_status ?? "residency unset"} · {row.salary_type ?? "pay unset"}
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.muted}>No payroll profile versions yet.</p>
        )}
      </section>
    </div>
  );
}

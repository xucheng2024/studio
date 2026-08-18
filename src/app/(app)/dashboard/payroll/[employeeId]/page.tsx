import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { PayrollProfileFields } from "@/components/dashboard/PayrollProfileFields";
import { PayrollSalaryFields } from "@/components/dashboard/PayrollSalaryFields";
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

        <p className={`${ui.sectionHeader} md:col-span-2`}>Identity</p>
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
        <PayrollProfileFields
          defaultResidency={profile?.residency_status ?? ""}
          defaultPrGrantedOn={profile?.pr_granted_on ?? ""}
          defaultShgFund={profile?.shg_fund ?? ""}
          defaultShgMode={profile?.shg_mode ?? "standard"}
          defaultShgCustomAmount={profile?.shg_custom_amount_sgd ?? ""}
          defaultShgProofNote={profile?.shg_proof_note ?? ""}
          defaultCpfFullRate={Boolean(profile?.cpf_full_rate_elected)}
          defaultEaPart4={Boolean(profile?.ea_part4_overtime_covered)}
          defaultIsWorkman={Boolean(profile?.is_workman)}
        >
          <p className={`${ui.sectionHeader} md:col-span-2`}>Pay</p>
          <PayrollSalaryFields
            defaultSalaryType={profile?.salary_type ?? ""}
            defaultBasicPay={profile?.basic_pay_sgd ?? ""}
            defaultWeeklyHours={profile?.weekly_hours ?? ""}
          />
          <p className={`${ui.sectionHeader} md:col-span-2`}>Statutory</p>
        </PayrollProfileFields>

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

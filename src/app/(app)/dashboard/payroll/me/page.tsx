import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { FormPhoneField } from "@/components/ui/FormPhoneField";
import { updateOwnPayrollContactAction } from "@/app/(app)/dashboard/actions";
import { getDashboardScope } from "@/lib/dashboard";
import { getOwnEmployeeForPayroll } from "@/lib/payroll-profiles";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { searchParams: Promise<{ studio_id?: string }> };

export default async function MyPayPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { studioIds, selectedStudioId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
  });
  const studioId = selectedStudioId ?? studioIds[0] ?? null;
  if (!studioId) return <p className={ui.muted}>Select a studio to update your contact details.</p>;

  const employee = await getOwnEmployeeForPayroll(user.id, studioId);
  if (!employee) {
    return (
      <div className="max-w-lg space-y-2">
        <h1 className={ui.h1}>My pay</h1>
        <p className={ui.muted}>No employee record is linked to this account. Ask the owner to add you in Staff Access.</p>
      </div>
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div>
        <h1 className={ui.h1}>My pay</h1>
        <p className={`mt-1 ${ui.muted}`}>
          You can update email and phone only. Payslips will appear here after payroll runs.
        </p>
      </div>
      <section className={ui.card}>
        <p className="text-sm text-stone-700 dark:text-stone-300">{employee.display_name}</p>
        <p className={`mt-1 ${ui.muted}`}>{employee.employee_number || "No employee number"}</p>
      </section>
      <ServerActionToastForm action={updateOwnPayrollContactAction} className={`${ui.card} grid gap-4`}>
        <input type="hidden" name="studio_id" value={studioId} />
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Email</span>
          <input className={ui.input} name="email" type="email" required defaultValue={employee.email ?? ""} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Phone</span>
          <FormPhoneField name="phone" defaultValue={employee.phone} />
        </label>
        <SubmitButton className={ui.btnPrimary}>Save contact</SubmitButton>
      </ServerActionToastForm>
    </div>
  );
}

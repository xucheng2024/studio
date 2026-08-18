import { DashboardAppLink } from "@/components/DashboardAppLink";
import { PayslipPrintButton } from "@/components/dashboard/PayslipPrintButton";
import { PayslipSendButton } from "@/components/dashboard/PayslipSendButton";
import { PayslipSheet } from "@/components/dashboard/PayslipSheet";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { isOwnerPayrollRole } from "@/lib/payroll-profiles";
import { resolvePayslipForUser } from "@/lib/payroll-payslips";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ runEmployeeId: string }> };

export default async function PayslipPage({ params }: Props) {
  const { runEmployeeId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const result = await resolvePayslipForUser({ runEmployeeId, userId: user.id, email: user.email });
  if (!result.ok) {
    return <p className={ui.muted}>{result.reason === "forbidden" ? "You can only open your own payslip." : "Payslip not found."}</p>;
  }
  const { ctx } = await getDashboardScopeForRoles(
    { userId: user.id, email: user.email, studioId: result.studioId, locationId: null },
    ["owner"],
  );
  const owner = isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId: result.studioId });
  const backHref = owner ? "/dashboard/payroll" : "/dashboard/payroll/me";
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>{owner ? "← Payroll" : "← My pay"}</DashboardAppLink>
        <PayslipPrintButton />
        <a className={ui.btnPrimarySm} href={`/api/payroll/payslip/${runEmployeeId}/pdf`}>Download PDF</a>
        <PayslipSendButton runEmployeeId={runEmployeeId} />
      </div>
      <PayslipSheet model={result.model} />
    </div>
  );
}

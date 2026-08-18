import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { isOwnerPayrollRole } from "@/lib/payroll-profiles";
import { buildPayrollReport, type PayrollReportKind, type PayrollReportRow } from "@/lib/payroll-reports";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { searchParams: Promise<{ studio_id?: string; period?: string }> };

const KINDS: Array<{ kind: PayrollReportKind; title: string }> = [
  { kind: "summary", title: "Payroll Summary" },
  { kind: "commission", title: "Commission Report" },
  { kind: "statutory", title: "Statutory Contribution Summary" },
];
const FORMATS = ["csv", "tsv", "xlsx", "xml"] as const;

function periodStartFromMonth(period: string | undefined) {
  return period && /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : null;
}

function ReportTable({ report }: { report: PayrollReportRow }) {
  if (!report.rows.length) return <p className={ui.muted}>No published payroll in this period.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500">
            {report.headers.map((header) => <th key={header} className="p-3">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, index) => (
            <tr key={`${row[0]}-${row[1]}-${index}`} className="border-t border-stone-200 dark:border-stone-800">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="p-3">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PayrollReportsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId } = await getDashboardScopeForRoles(
    { userId: user.id, email: user.email, studioId: sp.studio_id ?? null, locationId: null },
    ["owner"],
  );
  if (studioIds.length === 0) return <p className={ui.muted}>Only studio owners can open Payroll reports.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const studioId = selectedStudioId ?? studioIds[0];
  if (!isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId })) {
    return <p className={ui.muted}>Only studio owners can open Payroll reports.</p>;
  }

  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : "";
  const periodStart = periodStartFromMonth(period);
  const reports = await Promise.all(KINDS.map(({ kind }) => buildPayrollReport({ studioId, kind, periodStart })));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <DashboardAppLink href="/dashboard/payroll" className={`${ui.btnSecondarySm} mb-3`}>← Payroll</DashboardAppLink>
        <h1 className={ui.h1}>Payroll reports</h1>
        <p className={`mt-1 ${ui.muted}`}>Published runs only. Exports reuse the four-format report download.</p>
      </div>

      <form method="get" className={`${ui.card} flex flex-col gap-3 sm:flex-row sm:items-end`}>
        {sp.studio_id ? <input type="hidden" name="studio_id" value={sp.studio_id} /> : null}
        <label className="flex min-w-40 flex-1 flex-col gap-1.5">
          <span className={ui.label}>Month</span>
          <input className={ui.input} type="month" name="period" defaultValue={period} />
        </label>
        <button type="submit" className={ui.btnSecondarySm}>Filter</button>
      </form>

      {KINDS.map(({ kind, title }, index) => {
        const params = new URLSearchParams({ studio_id: studioId, kind });
        if (periodStart) params.set("period_start", periodStart);
        return (
          <section key={kind} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={ui.h2}>{title}</h2>
              <div className="flex flex-wrap gap-2">
                {FORMATS.map((format) => (
                  <a key={format} className={ui.btnSecondarySm} href={`/api/payroll/reports/export?${params}&format=${format}`}>
                    {format.toUpperCase()}
                  </a>
                ))}
              </div>
            </div>
            <ReportTable report={reports[index]} />
          </section>
        );
      })}
    </div>
  );
}

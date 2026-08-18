import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type PayrollReportKind = "summary" | "commission" | "statutory";

export type PayrollReportRow = {
  headers: string[];
  rows: Array<Array<string | number>>;
};

const PUBLISHED = ["finalised", "paid"] as const;

export async function buildPayrollReport(params: {
  studioId: string;
  kind: PayrollReportKind;
  periodStart?: string | null;
}): Promise<PayrollReportRow> {
  const admin = createAdminClient();
  let runQuery = admin
    .from("payroll_runs")
    .select("id, period_start, period_end, status, company_sdl_sgd, paid_on")
    .eq("studio_id", params.studioId)
    .in("status", [...PUBLISHED])
    .order("period_start", { ascending: false })
    .limit(24);
  if (params.periodStart) runQuery = runQuery.eq("period_start", params.periodStart);
  const { data: runs, error: runError } = await runQuery;
  if (runError) throw runError;
  const runList = runs ?? [];
  const runIds = runList.map((run) => run.id as string);
  const runById = new Map(runList.map((run) => [run.id as string, run]));
  if (!runIds.length) return emptyReport(params.kind);

  const { data: employees, error: employeeError } = await admin
    .from("payroll_run_employees")
    .select("id, payroll_run_id, employee_id, gross_sgd, total_deductions_sgd, net_sgd, employee_cpf_sgd, employer_cpf_sgd, sdl_sgd, shg_sgd, payslip_number")
    .in("payroll_run_id", runIds);
  if (employeeError) throw employeeError;
  const employeeIds = [...new Set((employees ?? []).map((row) => row.employee_id as string))];
  const { data: names } = employeeIds.length
    ? await admin.from("employees").select("id, display_name").in("id", employeeIds)
    : { data: [] as Array<{ id: string; display_name: string }> };
  const nameById = new Map((names ?? []).map((row) => [row.id as string, row.display_name as string]));

  let report: PayrollReportRow;
  if (params.kind === "commission") {
    const runEmployeeIds = (employees ?? []).map((row) => row.id as string);
    const { data: lines, error: lineError } = await admin
      .from("payroll_line_items")
      .select("payroll_run_employee_id, amount_sgd")
      .eq("item_code", "commission")
      .in("payroll_run_employee_id", runEmployeeIds.length ? runEmployeeIds : ["00000000-0000-4000-8000-000000000000"]);
    if (lineError) throw lineError;
    const commissionByRow = new Map((lines ?? []).map((line) => [line.payroll_run_employee_id as string, String(line.amount_sgd ?? "0")]));
    report = {
      headers: ["period", "employee", "payslip_number", "commission_sgd"],
      rows: (employees ?? []).map((row) => {
        const run = runById.get(row.payroll_run_id as string);
        return [
          run?.period_start ? String(run.period_start).slice(0, 7) : "",
          nameById.get(row.employee_id as string) ?? row.employee_id,
          row.payslip_number ?? "",
          commissionByRow.get(row.id as string) ?? "0.00",
        ];
      }),
    };
  } else if (params.kind === "statutory") {
    report = {
      headers: ["period", "employee", "payslip_number", "employee_cpf_sgd", "employer_cpf_sgd", "sdl_sgd", "shg_sgd"],
      rows: (employees ?? []).map((row) => {
        const run = runById.get(row.payroll_run_id as string);
        return [
          run?.period_start ? String(run.period_start).slice(0, 7) : "",
          nameById.get(row.employee_id as string) ?? row.employee_id,
          row.payslip_number ?? "",
          String(row.employee_cpf_sgd ?? "0"),
          String(row.employer_cpf_sgd ?? "0"),
          String(row.sdl_sgd ?? "0"),
          String(row.shg_sgd ?? "0"),
        ];
      }),
    };
  } else {
    report = {
      headers: ["period", "employee", "payslip_number", "gross_sgd", "deductions_sgd", "net_sgd", "company_sdl_sgd", "paid_on"],
      rows: (employees ?? []).map((row) => {
        const run = runById.get(row.payroll_run_id as string);
        return [
          run?.period_start ? String(run.period_start).slice(0, 7) : "",
          nameById.get(row.employee_id as string) ?? row.employee_id,
          row.payslip_number ?? "",
          String(row.gross_sgd ?? "0"),
          String(row.total_deductions_sgd ?? "0"),
          String(row.net_sgd ?? "0"),
          String(run?.company_sdl_sgd ?? "0"),
          run?.paid_on ? String(run.paid_on) : "Pending",
        ];
      }),
    };
  }

  return report;
}

function emptyReport(kind: PayrollReportKind): PayrollReportRow {
  if (kind === "commission") return { headers: ["period", "employee", "payslip_number", "commission_sgd"], rows: [] };
  if (kind === "statutory") {
    return { headers: ["period", "employee", "payslip_number", "employee_cpf_sgd", "employer_cpf_sgd", "sdl_sgd", "shg_sgd"], rows: [] };
  }
  return { headers: ["period", "employee", "payslip_number", "gross_sgd", "deductions_sgd", "net_sgd", "company_sdl_sgd", "paid_on"], rows: [] };
}

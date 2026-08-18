import "server-only";

import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { getOwnEmployeeForPayroll, isOwnerPayrollRole } from "@/lib/payroll-profiles";
import { writeStrongAudit } from "@/lib/strong-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPayslipModel, type PayslipModel } from "@/lib/payslip-model";
import type { PayrollRunEmployeeRow, PayrollRunRow } from "@/lib/payroll-runs";

const PUBLISHED = ["finalised", "paid"] as const;

export type PublishedPayslipRow = {
  runEmployeeId: string;
  payslipNumber: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  netSgd: string;
  paidOn: string | null;
};

async function loadSnapshot(runEmployeeId: string) {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("payroll_run_employees")
    .select("*")
    .eq("id", runEmployeeId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const { data: run, error: runError } = await admin
    .from("payroll_runs")
    .select("id, studio_id, period_start, period_end, status, rule_version_id, paid_on")
    .eq("id", row.payroll_run_id)
    .maybeSingle();
  if (runError) throw runError;
  if (!run || run.studio_id !== row.studio_id) return null;
  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, display_name, employee_number, user_id")
    .eq("id", row.employee_id)
    .eq("studio_id", row.studio_id)
    .maybeSingle();
  if (employeeError) throw employeeError;
  const { data: studio, error: studioError } = await admin
    .from("studios")
    .select("id, name")
    .eq("id", row.studio_id)
    .maybeSingle();
  if (studioError) throw studioError;
  const { data: profile } = row.profile_version_id
    ? await admin
        .from("employee_payroll_profile_versions")
        .select("salary_type, basic_pay_sgd")
        .eq("id", row.profile_version_id)
        .maybeSingle()
    : { data: null };
  const { data: lines, error: lineError } = await admin
    .from("payroll_line_items")
    .select("item_code, amount_sgd, sort_order")
    .eq("payroll_run_employee_id", runEmployeeId)
    .order("sort_order");
  if (lineError) throw lineError;
  return {
    row: row as PayrollRunEmployeeRow & { payslip_number: string | null; studio_id: string },
    run: run as Pick<PayrollRunRow, "id" | "studio_id" | "period_start" | "period_end" | "status" | "rule_version_id" | "paid_on">,
    employee: employee as { id: string; display_name: string; employee_number: string | null; user_id: string | null } | null,
    studioName: (studio as { name?: string } | null)?.name ?? "Studio",
    profile: (profile as { salary_type?: string | null; basic_pay_sgd?: string | null } | null) ?? null,
    lines: (lines ?? []) as Array<{ item_code: string; amount_sgd: string }>,
  };
}

export async function resolvePayslipForUser(params: {
  runEmployeeId: string;
  userId: string;
  email?: string | null;
}): Promise<{ ok: true; model: PayslipModel; studioId: string } | { ok: false; reason: "not_found" | "forbidden" }> {
  const snapshot = await loadSnapshot(params.runEmployeeId);
  if (!snapshot?.employee) return { ok: false, reason: "not_found" };
  const { ctx } = await getDashboardScopeForRoles(
    { userId: params.userId, email: params.email ?? null, studioId: snapshot.run.studio_id, locationId: null },
    ["owner"],
  );
  const owner = isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId: snapshot.run.studio_id });
  if (owner) {
    return getPublishedPayslip({ runEmployeeId: params.runEmployeeId, actorId: params.userId, actorRole: "owner" });
  }
  const own = await getOwnEmployeeForPayroll(params.userId, snapshot.run.studio_id);
  if (!own || own.id !== snapshot.employee.id) return { ok: false, reason: "forbidden" };
  return getPublishedPayslip({
    runEmployeeId: params.runEmployeeId,
    actorId: params.userId,
    actorRole: "employee",
    employeeUserId: params.userId,
  });
}

export async function getPublishedPayslip(params: {
  runEmployeeId: string;
  actorId: string;
  actorRole: "owner" | "employee";
  employeeUserId?: string | null;
}): Promise<{ ok: true; model: PayslipModel; studioId: string } | { ok: false; reason: "not_found" | "forbidden" }> {
  const snapshot = await loadSnapshot(params.runEmployeeId);
  if (!snapshot?.employee) return { ok: false, reason: "not_found" };
  if (!PUBLISHED.includes(snapshot.run.status as (typeof PUBLISHED)[number]) || !snapshot.row.payslip_number) {
    return { ok: false, reason: "not_found" };
  }
  if (params.actorRole === "employee" && snapshot.employee.user_id !== params.employeeUserId) {
    return { ok: false, reason: "forbidden" };
  }
  const model = buildPayslipModel({
    payslipNumber: snapshot.row.payslip_number,
    employerName: snapshot.studioName,
    employeeName: snapshot.employee.display_name,
    employeeNumber: snapshot.employee.employee_number,
    paymentDate: snapshot.run.paid_on,
    periodStart: snapshot.run.period_start,
    periodEnd: snapshot.run.period_end,
    salaryType: snapshot.profile?.salary_type,
    basicPaySgd: snapshot.profile?.basic_pay_sgd,
    hoursWorked: snapshot.row.hours_worked,
    daysActuallyWorked: snapshot.row.days_actually_worked,
    overtimeHours: snapshot.row.overtime_hours,
    netSgd: snapshot.row.net_sgd,
    ruleVersionId: snapshot.run.rule_version_id,
    lines: snapshot.lines,
  });
  await writeStrongAudit({
    studioId: snapshot.run.studio_id,
    actorType: "user",
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "payroll_payslip_viewed",
    targetType: "payroll_run_employee",
    targetId: params.runEmployeeId,
    afterState: { payslip_number: snapshot.row.payslip_number },
  });
  return { ok: true, model, studioId: snapshot.run.studio_id };
}

export async function listPublishedPayslipsForEmployee(params: { studioId: string; employeeId: string }) {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("payroll_run_employees")
    .select("id, payslip_number, net_sgd, payroll_run_id")
    .eq("studio_id", params.studioId)
    .eq("employee_id", params.employeeId)
    .not("payslip_number", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const runIds = [...new Set((rows ?? []).map((row) => row.payroll_run_id as string))];
  if (!runIds.length) return [] as PublishedPayslipRow[];
  const { data: runs, error: runError } = await admin
    .from("payroll_runs")
    .select("id, period_start, period_end, status, paid_on")
    .in("id", runIds)
    .in("status", [...PUBLISHED]);
  if (runError) throw runError;
  const runById = new Map((runs ?? []).map((run) => [run.id as string, run]));
  return (rows ?? []).flatMap((row) => {
    const run = runById.get(row.payroll_run_id as string);
    if (!run || !row.payslip_number) return [];
    return [{
      runEmployeeId: row.id as string,
      payslipNumber: row.payslip_number as string,
      periodStart: run.period_start as string,
      periodEnd: run.period_end as string,
      status: run.status as string,
      netSgd: String(row.net_sgd ?? "0"),
      paidOn: (run.paid_on as string | null) ?? null,
    }];
  });
}
